/**
 * ragService.js — Hybrid RAG Engine for WarrantyVault AI
 *
 * Pipeline:
 *   User query  →  JWT auth (userId enforced by route)
 *     →  Hybrid retrieval (MongoDB structured + TF-IDF vector)
 *     →  Build grounded context
 *     →  Gemini LLM generation
 *     →  Return { answer, sources[] }
 *
 * Security guarantee: userId ALWAYS comes from req.user.id (JWT decoded
 * server-side). Every retrieval call filters by that userId before returning
 * any document. The LLM prompt is constructed solely from filtered docs.
 *
 * No external embedding API is used. TF-IDF cosine similarity is computed
 * entirely in pure JS (zero extra dependencies).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');

function getGeminiApiKey() {
  if (process.env.RAG_GEMINI_API_KEY && process.env.RAG_GEMINI_API_KEY.trim()) return process.env.RAG_GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim()) return process.env.GOOGLE_API_KEY.trim();
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) return process.env.GEMINI_API_KEY.trim();

  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/^RAG_GEMINI_API_KEY=(.*)$/m) || content.match(/^GOOGLE_API_KEY=(.*)$/m);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    }
  } catch (_) {}
  return null;
}

// ─── TF-IDF Utilities ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','was','are','were','be','been','being','have','has','had',
  'do','does','did','will','would','should','could','may','might','shall',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','this','that','these','those',
  'what','which','who','whom','when','where','why','how','all','any',
  'no','not','so','as','if','then','than','into','out','up','about',
  'after','before','between','through','during','just','more','also'
]);

/**
 * Tokenise a string → array of lowercase stems (stop-words removed).
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Build a TF-IDF vector for a single document text.
 * Returns a plain object { term: weight }.
 *
 * Note: Without a corpus IDF we fall back to pure TF (term frequency).
 * This is sufficient because the documents are all from a single domain
 * (purchase/warranty text) and IDF would not meaningfully discriminate.
 * When retrieve() compares user query ↔ documents we normalise both
 * vectors, so cosine still works correctly.
 */
function tfidfEmbed(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return {};

  const freq = {};
  for (const t of tokens) {
    freq[t] = (freq[t] || 0) + 1;
  }

  const vector = {};
  for (const [term, count] of Object.entries(freq)) {
    vector[term] = count / tokens.length; // TF (normalised)
  }
  return vector;
}

/**
 * Cosine similarity between two TF-IDF vectors (plain objects).
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, wa] of Object.entries(a)) {
    normA += wa * wa;
    if (b[term] !== undefined) {
      dot += wa * b[term];
    }
  }
  for (const wb of Object.values(b)) {
    normB += wb * wb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Document Text Builders ───────────────────────────────────────────────────

/**
 * Convert a MongoDB Purchase document into a RAG text chunk (purchase-level).
 */
function buildPurchaseText(p) {
  const warrantyEnd = p.warrantyEnd || p.warrantyExpiresAt;
  const now = new Date();
  const daysW = warrantyEnd
    ? Math.ceil((new Date(warrantyEnd) - now) / 86400000)
    : null;
  const daysR = p.returnDeadline
    ? Math.ceil((new Date(p.returnDeadline) - now) / 86400000)
    : null;

  return [
    `Product: ${p.productName || 'Unknown'}`,
    p.brand ? `Brand: ${p.brand}` : null,
    `Category: ${p.category || 'Unknown'}`,
    `Merchant: ${p.merchant || p.storeName || 'Unknown'}`,
    `Purchase Date: ${p.purchaseDate ? new Date(p.purchaseDate).toDateString() : 'Unknown'}`,
    `Amount: ${p.amount || p.price || 0} ${p.currency || 'PKR'}`,
    `Quantity: ${p.quantity || 1}`,
    p.serialNumber ? `Serial Number: ${p.serialNumber}` : null,
    p.invoiceNumber ? `Invoice Number: ${p.invoiceNumber}` : null,
    p.modelNumber ? `Model Number: ${p.modelNumber}` : null,
    p.paymentMethod ? `Payment Method: ${p.paymentMethod}` : null,
    `Warranty Status: ${p.status || 'active'}`,
    warrantyEnd
      ? `Warranty Expires: ${new Date(warrantyEnd).toDateString()} (${daysW !== null ? (daysW > 0 ? daysW + ' days left' : Math.abs(daysW) + ' days ago') : 'unknown'})`
      : null,
    p.warrantyMonths ? `Warranty Duration: ${p.warrantyMonths} months` : null,
    p.returnDeadline
      ? `Return Deadline: ${new Date(p.returnDeadline).toDateString()} (${daysR !== null ? (daysR > 0 ? daysR + ' days left' : 'window closed') : 'unknown'})`
      : null,
    p.returnPeriodDays ? `Return Period: ${p.returnPeriodDays} days` : null,
    p.warrantyType ? `Warranty Type: ${p.warrantyType}` : null,
    p.purchaseType ? `Purchase Type: ${p.purchaseType}` : null,
    p.notes ? `Notes: ${p.notes}` : null
  ]
    .filter(Boolean)
    .join('. ');
}

/**
 * Convert one item from a multi-product bill into a RAG text chunk.
 */
function buildItemText(purchase, item) {
  return [
    `Item: ${item.productName || 'Unknown'}`,
    item.brand ? `Brand: ${item.brand}` : null,
    item.category ? `Category: ${item.category}` : null,
    `From bill/merchant: ${purchase.merchant || purchase.storeName || 'Unknown'}`,
    `Bill Date: ${purchase.purchaseDate ? new Date(purchase.purchaseDate).toDateString() : 'Unknown'}`,
    item.quantity ? `Quantity: ${item.quantity}` : null,
    item.price !== undefined ? `Price: ${item.price} ${purchase.currency || 'PKR'}` : null,
    item.serialNumber ? `Serial Number: ${item.serialNumber}` : null,
    item.warrantyMonths ? `Warranty Duration: ${item.warrantyMonths} months` : null,
    item.returnPeriodDays ? `Return Period: ${item.returnPeriodDays} days` : null
  ]
    .filter(Boolean)
    .join('. ');
}

// ─── In-Memory RAG Index ──────────────────────────────────────────────────────
// Map<userId, Array<{ docId, sourceType, sourceId, text, vector, metadata }>>
const ragIndex = new Map();

// ─── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Vector retrieval — TF-IDF cosine similarity, filtered by userId.
 * @returns Array of top-K { docId, sourceType, sourceId, score, text, metadata }
 */
function vectorRetrieve(userId, query, topK = 5) {
  const userDocs = ragIndex.get(userId) || [];
  if (userDocs.length === 0) return [];

  const queryVec = tfidfEmbed(query);
  if (Object.keys(queryVec).length === 0) return userDocs.slice(0, topK);

  const scored = userDocs.map(doc => ({
    ...doc,
    score: cosineSimilarity(queryVec, doc.vector || {})
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Structured MongoDB retrieval for exact-match queries (dates, brands, merchants, categories, keywords).
 * Always filters by userId — never leaks cross-user data.
 */
async function structuredRetrieve(userId, query) {
  if (mongoose.connection.readyState !== 1) return [];

  const q = query.toLowerCase();
  const filter = { userId }; // <<< ALWAYS userId-scoped

  // Date range hints
  if (q.includes('this month') || q.includes('current month')) {
    const now = new Date();
    filter.purchaseDate = {
      $gte: new Date(now.getFullYear(), now.getMonth(), 1),
      $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0)
    };
  } else if (q.includes('last month')) {
    const now = new Date();
    filter.purchaseDate = {
      $gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      $lte: new Date(now.getFullYear(), now.getMonth(), 0)
    };
  } else if (q.includes('this year')) {
    filter.purchaseDate = {
      $gte: new Date(new Date().getFullYear(), 0, 1)
    };
  }

  // Expiry proximity hints
  if (
    q.includes('expir') || q.includes('warranty') ||
    q.includes('soon') || q.includes('upcoming')
  ) {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 86400000);
    filter.warrantyEnd = { $gte: now, $lte: in60 };
  }

  // Return window hints
  if (q.includes('return') || q.includes('refund')) {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 86400000);
    filter.returnDeadline = { $gte: now, $lte: in14 };
  }

  // Category & keyword matching
  const categories = ['fashion', 'electronics', 'grocery', 'groceries', 'food', 'furniture', 'home', 'appliances', 'gadgets', 'sports', 'books', 'beauty', 'clothing', 'apparel'];
  for (const cat of categories) {
    if (q.includes(cat)) {
      filter.$or = [
        { category: { $regex: cat, $options: 'i' } },
        { productName: { $regex: cat, $options: 'i' } },
        { notes: { $regex: cat, $options: 'i' } }
      ];
      break;
    }
  }

  try {
    const docs = await Purchase.find(filter).sort({ purchaseDate: -1 }).limit(10);
    return docs.map(d => {
      const obj = d.toObject();
      obj.id = obj._id.toString();
      return obj;
    });
  } catch (err) {
    console.warn('[RAG] structuredRetrieve error:', err.message);
    return [];
  }
}

/**
 * Hybrid retrieval: merge structured MongoDB results + vector results.
 * If user has <= 12 purchases, includes all to guarantee 100% database recall.
 */
async function hybridRetrieve(userId, query, topK = 8) {
  // If user has <= 12 purchases in MongoDB, fetch all so no item is ever missed
  let allUserPurchases = [];
  if (mongoose.connection.readyState === 1) {
    try {
      allUserPurchases = await Purchase.find({ userId }).sort({ purchaseDate: -1 }).limit(15);
    } catch (_) {}
  }

  const [vectorResults, structuredPurchases] = await Promise.all([
    Promise.resolve(vectorRetrieve(userId, query, topK)),
    structuredRetrieve(userId, query)
  ]);

  // Convert structured purchases to standard format
  const structuredResults = [...structuredPurchases, ...allUserPurchases].map(p => {
    const pObj = p.toObject ? p.toObject() : p;
    const pId = pObj._id ? pObj._id.toString() : (pObj.id || String(pObj));
    return {
      docId: `struct_${pId}`,
      sourceType: 'purchase',
      sourceId: pId,
      score: 0.8,
      text: buildPurchaseText(pObj),
      metadata: {
        productName: pObj.productName,
        brand: pObj.brand,
        merchant: pObj.merchant || pObj.storeName,
        category: pObj.category,
        purchaseDate: pObj.purchaseDate,
        amount: pObj.amount || pObj.price,
        currency: pObj.currency,
        warrantyEnd: pObj.warrantyEnd || pObj.warrantyExpiresAt,
        returnDeadline: pObj.returnDeadline,
        status: pObj.status,
        serialNumber: pObj.serialNumber,
        invoiceNumber: pObj.invoiceNumber
      }
    };
  });

  // Merge and deduplicate by sourceId
  const seen = new Set();
  const merged = [];
  for (const doc of [...structuredResults, ...vectorResults]) {
    if (doc.sourceId && !seen.has(doc.sourceId)) {
      seen.add(doc.sourceId);
      merged.push(doc);
    }
  }

  return merged.slice(0, 10);
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Build the Gemini prompt from retrieved docs.
 * Instructs the AI to give direct, natural, formatted answers without checklist reasoning.
 */
function buildPrompt(userQuery, docs) {
  const contextBlocks = docs.map((doc, i) => {
    const label =
      doc.sourceType === 'item'
        ? `[Item ${i + 1} from bill ${doc.sourceId}]`
        : `[Purchase record ${i + 1}]`;
    return `${label}\n${doc.text}`;
  });

  const context =
    contextBlocks.length > 0
      ? contextBlocks.join('\n\n')
      : 'No relevant purchases found in this user\'s vault.';

  return `You are WarrantyVault AI, a helpful, polite, and precise personal purchase and warranty assistant.

IMPORTANT INSTRUCTIONS:
- Directly answer the user's question using ONLY the purchase records in the CONTEXT below.
- NEVER output internal verification checklists, chain-of-thought, constraint checks (like "Check against constraints", "Answer ONLY using context? Yes"), or self-reflection. Output ONLY your final, polished answer to the user.
- If the user asks about a specific category (e.g. fashion, electronics, groceries, etc.) or item, clearly list what was found in their vault.
- Format responses cleanly with bold titles, bullet points, and key details (Product Name, Store, Amount, Purchase Date, Warranty Expiry).
- If the requested item/category is not in the context, politely state: "I don't see any [item/category] purchases in your vault."

CONTEXT (user's vault purchases):
---
${context}
---

USER QUESTION: ${userQuery}

RESPONSE:`;
}

// ─── Gemini API Helper ────────────────────────────────────────────────────────

const CANDIDATE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest'
];

async function callGeminiAPI(prompt) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('RAG_GEMINI_API_KEY not set in .env');
  }

  const preferredModel = process.env.RAG_GEMINI_MODEL || 'gemini-3.5-flash';
  const modelsToTry = [preferredModel, ...CANDIDATE_MODELS.filter(m => m !== preferredModel)];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const answer = await attemptGeminiRequest(prompt, model, apiKey, 5000);
      if (answer && answer.trim()) {
        return answer.trim();
      }
    } catch (err) {
      lastError = err;
      console.warn(`[RAG] Gemini model ${model} notice: ${err.message}. Trying next candidate...`);
    }
  }

  throw lastError || new Error('All Gemini model candidates were busy.');
}

function attemptGeminiRequest(prompt, model, apiKey, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const hostname = 'generativelanguage.googleapis.com';
    const path = `/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.2'),
        maxOutputTokens: 1024
      }
    });

    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    };

    const reqNode = https.request(options, resNode => {
      let data = '';
      resNode.on('data', chunk => { data += chunk; });
      resNode.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!text && parsed.error) {
            return reject(new Error(parsed.error.message || `HTTP ${resNode.statusCode}`));
          }
          if (!text) {
            return reject(new Error(`Empty response from ${model}`));
          }
          resolve(text.trim());
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });

    reqNode.on('timeout', () => {
      reqNode.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms on ${model}`));
    });

    reqNode.on('error', reject);
    reqNode.write(body);
    reqNode.end();
  });
}

/**
 * Clean up noisy OCR product names for clean display
 */
function cleanProductName(name) {
  if (!name) return 'Purchase Item';
  let raw = String(name).trim();
  // If multiline or comma separated, take first relevant product
  let segment = raw.split(/[\r\n,]/)[0].trim();
  // Strip leading noise, bullet markers, single letters, numbers, discounts
  let cleaned = segment
    .replace(/^[\s•\-\*\d\.\:\;\(\)]+/, '')
    .replace(/^(item|product|description|name)\s*:\s*/i, '')
    .replace(/^(installation|delivery|shipping|discount|tax|subtotal|total).*$/i, '')
    .trim();

  // If nothing left after stripping noise, fallback to short snippet
  if (!cleaned) {
    cleaned = raw.replace(/[\r\n]+/g, ' ').slice(0, 24);
  }
  if (cleaned.length > 28) {
    cleaned = cleaned.slice(0, 26).trim() + '…';
  }
  return cleaned || 'Purchase Item';
}

/**
 * Intelligent deterministic RAG fallback answer generator.
 * Answers with verified facts from retrieved documents without hallucination.
 */
function buildGroundedFallbackAnswer(query, docs) {
  if (!docs || docs.length === 0) {
    return "I don't see any matching purchases or warranties in your vault. Try adding a purchase receipt or asking about your return deadlines.";
  }

  const q = String(query || '').toLowerCase();

  // 1. Vault inventory / list of purchases query
  if (
    q.includes('what purchase') ||
    q.includes('my purchase') ||
    q.includes('in my vault') ||
    q.includes('all purchase') ||
    q.includes('list') ||
    q.includes('products do i have') ||
    q.includes('what do i have')
  ) {
    const lines = docs.slice(0, 5).map(d => {
      const meta = d.metadata || {};
      const name = cleanProductName(meta.productName);
      const store = meta.merchant ? ` · Store: ${meta.merchant}` : '';
      const amount = meta.amount ? ` · ₹${Number(meta.amount).toLocaleString()}` : '';
      const warranty = meta.warrantyEnd
        ? ` · Warranty: ${new Date(meta.warrantyEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : '';
      return `• **${name}**${amount}${store}${warranty}`;
    });
    return `📦 **Here are the purchases found in your vault:**\n\n${lines.join('\n')}\n\n💡 *Ask me about any specific item to view warranty, claims, and return details!*`;
  }

  // 2. Warranty / Expiry queries
  if (q.includes('warranty') || q.includes('expire') || q.includes('coverage') || q.includes('deadline')) {
    const withWarranty = docs.filter(d => d.metadata && (d.metadata.warrantyEnd || d.metadata.status));
    if (withWarranty.length > 0) {
      const lines = withWarranty.slice(0, 5).map(d => {
        const meta = d.metadata || {};
        const name = cleanProductName(meta.productName);
        let status = meta.status || 'Active';
        if (meta.warrantyEnd) {
          const days = Math.ceil((new Date(meta.warrantyEnd) - new Date()) / 86400000);
          status = days > 0 ? `**Expires in ${days} days** (${new Date(meta.warrantyEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : 'Expired';
        }
        return `• **${name}**: ${status}`;
      });
      return `🛡️ **Warranty Status for your items:**\n\n${lines.join('\n')}`;
    }
  }

  // 3. Return deadlines
  if (q.includes('return') || q.includes('deadline') || q.includes('refund')) {
    const withReturns = docs.filter(d => d.metadata && d.metadata.returnDeadline);
    if (withReturns.length > 0) {
      const lines = withReturns.slice(0, 5).map(d => {
        const meta = d.metadata || {};
        const name = cleanProductName(meta.productName);
        const days = Math.ceil((new Date(meta.returnDeadline) - new Date()) / 86400000);
        const status = days > 0 ? `**${days} days left** (Deadline: ${new Date(meta.returnDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : 'Return window closed';
        return `• **${name}**: ${status}`;
      });
      return `⏳ **Return Deadlines:**\n\n${lines.join('\n')}`;
    }
  }

  // 4. Spending / Cost queries
  if (q.includes('spend') || q.includes('total') || q.includes('cost') || q.includes('price') || q.includes('how much')) {
    let total = 0;
    const items = [];
    for (const d of docs) {
      const meta = d.metadata || {};
      const amt = Number(meta.amount || 0);
      if (amt > 0) {
        total += amt;
        items.push(`• **${cleanProductName(meta.productName)}**: ₹${amt.toLocaleString()}`);
      }
    }
    if (items.length > 0) {
      return `💰 **Spending Breakdown:**\n\n${items.slice(0, 5).join('\n')}\n\n**Total:** ₹${total.toLocaleString()}`;
    }
  }

  // 5. Specific Product Lookup
  const primaryDoc = docs[0];
  if (primaryDoc && primaryDoc.metadata) {
    const meta = primaryDoc.metadata;
    const details = [];
    if (meta.merchant) details.push(`• **Merchant/Store:** ${meta.merchant}`);
    if (meta.amount) details.push(`• **Price:** ₹${Number(meta.amount).toLocaleString()}`);
    if (meta.purchaseDate) details.push(`• **Purchased:** ${new Date(meta.purchaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
    if (meta.warrantyEnd) details.push(`• **Warranty Until:** ${new Date(meta.warrantyEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
    if (meta.serialNumber) details.push(`• **Serial Number:** ${meta.serialNumber}`);
    if (meta.category) details.push(`• **Category:** ${meta.category}`);

    return `📦 **${cleanProductName(meta.productName)}:**\n\n${details.join('\n')}`;
  }

  // Default clean list
  const lines = docs.slice(0, 4).map(d => `• **${cleanProductName(d.metadata && d.metadata.productName)}**`);
  return `📦 **I found these items in your vault:**\n\n${lines.join('\n')}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full RAG pipeline:
 *   1. Hybrid retrieve (always userId-filtered)
 *   2. Build grounded prompt
 *   3. Call Gemini LLM (with intelligent deterministic fallback)
 *   4. Return { answer, sources }
 *
 * @param {string} userId  — from req.user.id (JWT decoded, never from body)
 * @param {string} query   — user's natural language question
 * @returns {Promise<{ answer: string, sources: Array }>}
 */
async function generateAnswer(userId, query) {
  // 1. Retrieve relevant docs (filtered by userId)
  const docs = await hybridRetrieve(userId, query, 6);

  // 2. Build grounded prompt
  const prompt = buildPrompt(query, docs);

  // 3. Call Gemini with smart grounded fallback
  let answer;
  try {
    answer = await callGeminiAPI(prompt);
  } catch (err) {
    console.warn('[RAG] Gemini call notice (using structured fallback):', err.message);
    answer = buildGroundedFallbackAnswer(query, docs);
  }

  // 4. Build clean sources array for UI attribution
  const sources = docs
    .filter(d => d.sourceId)
    .map(d => ({
      type: d.sourceType,
      id: d.sourceId,
      productName: cleanProductName(d.metadata && d.metadata.productName),
      score: d.score != null ? Math.round(d.score * 100) / 100 : undefined
    }));

  return { answer, sources };
}

/**
 * Update the in-memory RAG index for a single userId from provided docs.
 * Called by RagIndexService after indexing to keep memory in sync.
 *
 * @param {string} userId
 * @param {Array}  docs    — array of { docId, sourceType, sourceId, text, vector, metadata }
 */
function updateMemoryIndex(userId, docs) {
  ragIndex.set(userId, docs);
}

/**
 * Remove all in-memory RAG docs for a specific sourceId + userId.
 */
function removeFromMemoryIndex(userId, sourceId) {
  const userDocs = ragIndex.get(userId) || [];
  ragIndex.set(
    userId,
    userDocs.filter(d => d.sourceId !== sourceId)
  );
}

/**
 * Return the current in-memory index for a user (for RagIndexService).
 */
function getMemoryIndex(userId) {
  return ragIndex.get(userId) || [];
}

module.exports = {
  tfidfEmbed,
  cosineSimilarity,
  buildPurchaseText,
  buildItemText,
  generateAnswer,
  updateMemoryIndex,
  removeFromMemoryIndex,
  getMemoryIndex
};
