/**
 * AI Vision Receipt Scanner Service — Task 5
 *
 * Reads a receipt image and extracts structured purchase data using a vision
 * LLM. Provider-agnostic:
 *
 *   1. Google Gemini (native REST API)          — AI_PROVIDER=gemini (default)
 *   2. OpenAI-compatible chat/completions       — AI_PROVIDER=openai
 *      (works with OpenAI, OpenRouter, Groq, Azure OpenAI, etc.)
 *   3. Rule-based parser                        — automatic fallback when no
 *      API key is configured or the AI call fails.
 *
 * No SDKs are required — Node 18+ global fetch is used. All credentials live
 * in backend/.env only (never in frontend code).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const AiReceiptParser = require('./aiReceiptParser');

// ---------------------------------------------------------------------------
// Environment loading (dotenv already runs in server.js; manual read as backup)
// ---------------------------------------------------------------------------
function readEnv(key, fallback = '') {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(__dirname, '..', '.env');
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1]) return match[1].trim();
    }
  } catch (err) {}
  return fallback;
}

function getConfig() {
  return {
    provider: (readEnv('AI_PROVIDER', 'gemini') || 'gemini').toLowerCase(),
    googleApiKey: readEnv('GOOGLE_API_KEY'),
    geminiModel: readEnv('GEMINI_MODEL', 'gemini-flash-latest'),
    openaiApiKey: readEnv('OPENAI_API_KEY'),
    openaiModel: readEnv('OPENAI_MODEL', 'gpt-4o-mini'),
    openaiBaseUrl: readEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    temperature: parseFloat(readEnv('AI_TEMPERATURE', '0.2'))
  };
}

// ---------------------------------------------------------------------------
// Prompt: forces the model to return ONLY structured JSON
// ---------------------------------------------------------------------------
const EXTRACTION_SCHEMA = {
  productName: 'string',
  brand: 'string',
  storeName: 'string',
  purchaseDate: 'YYYY-MM-DD',
  price: 'number',
  currency: 'string (ISO code)',
  category: 'string',
  warrantyMonths: 'number',
  warrantyType: 'string',
  returnPeriodDays: 'number',
  serialNumber: 'string',
  modelNumber: 'string',
  invoiceNumber: 'string',
  paymentMethod: 'string',
  items: 'array of { name, price, quantity }',
  notes: 'string',
  confidenceScore: 'number 0-1'
};

function buildSystemPrompt() {
  return [
    'You are a precise receipt & invoice OCR specialist.',
    'Extract purchase details from the receipt image and return ONLY valid JSON with exactly these keys:',
    JSON.stringify(EXTRACTION_SCHEMA, null, 2),
    'Rules:',
    '- productName: the main purchased item (most expensive / first line item). If the receipt has multiple items, use the most expensive one, or the item name itself. null if not readable.',
    '- storeName: the merchant name printed on the receipt. null if not readable.',
    '- price: the grand total actually paid (use the TOTAL line, not subtotal). null if not readable.',
    '- purchaseDate: date of purchase as YYYY-MM-DD. null if not readable.',
    '- category: one of Electronics, Home Appliances, Gadgets, Vehicles, Furniture, Fashion, Office, Sports, Other. null if not printed.',
    '- warrantyMonths: months of warranty mentioned on the receipt only. null if not printed.',
    '- returnPeriodDays: days in the store return policy IF printed. null if not printed.',
    '- serialNumber / modelNumber / invoiceNumber: leave null if not visible.',
    '- items: every line item as objects with EXACTLY these keys: {"name": string, "price": number, "quantity": number, "serialNumber": string}. Use "name", NOT "description".',
    '- notes: one short sentence summarizing warranty or return policy printed on the receipt, or null.',
    '- confidenceScore: how confident you are (0.0 - 1.0).',
    'NEVER guess, assume, predict, or invent values not visible on the receipt. Do not include markdown fences, commentary, or keys not listed.'
  ].join('\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry — Gemini free tier frequently returns 429/503 during
 * demand spikes, so retry transient failures with backoff before giving up.
 */
async function fetchWithRetry(url, options, attempts = 4) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status === 500 || res.status === 503) {
        lastErr = new Error(`Gemini API error ${res.status} (attempt ${attempt}/${attempts})`);
        // Rate limits (429) need longer backoff: 3s, 6s, 9s ...
        await sleep(res.status === 429 ? 3000 * attempt : 1200 * attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(1000 * attempt);
    }
  }
  throw lastErr || new Error('Gemini API unreachable.');
}

// ---------------------------------------------------------------------------
// Gemini REST API
// ---------------------------------------------------------------------------
async function scanWithGemini(imageBase64, mimeType, filename, rawText, config) {
  if (!config.googleApiKey) return null;

  const parts = [
    { text: 'Analyze this receipt image and extract the purchase details.' }
  ];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } });
  }
  if (rawText) {
    parts.push({ text: `Additional OCR text if useful:\n${rawText}` });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${encodeURIComponent(config.googleApiKey)}`;

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return AiVisionService.parseJsonFromLlm(text, 'gemini');
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat/completions (OpenAI, OpenRouter, Groq, Azure, ...)
// ---------------------------------------------------------------------------
async function scanWithOpenAiCompat(imageBase64, mimeType, filename, rawText, config) {
  if (!config.openaiApiKey) return null;

  const content = [
    { type: 'text', text: buildSystemPrompt() }
  ];
  if (imageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` }
    });
  }
  if (rawText) {
    content.push({ type: 'text', text: `Additional OCR text if useful:\n${rawText}` });
  }

  const res = await fetch(`${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: config.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content }
      ],
      max_tokens: 2048
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return AiVisionService.parseJsonFromLlm(text, 'openai');
}

// ---------------------------------------------------------------------------
// Strict scanner mode (/api/purchases/scan + /api/scanner/analyze)
// Full pipeline: real image -> sharp preprocessing -> Tesseract OCR -> Gemini
// (image + OCR text) -> strict 23-field extraction -> OCR validation.
// Extracts ONLY what is visibly printed on the receipt. Never guesses.
// ---------------------------------------------------------------------------
const STRICT_SCHEMA_KEYS = [
  'productName', 'brand', 'merchant', 'category', 'purchaseType',
  'purchaseDate', 'amount', 'currency', 'quantity', 'tax', 'discount',
  'paymentMethod', 'orderId', 'invoiceNumber', 'serialNumber', 'modelNumber',
  'returnPeriodDays', 'returnDeadline', 'warrantyStart', 'warrantyEnd',
  'warrantyMonths', 'warrantyType', 'notes'
];

function buildStrictPrompt(ocrText) {
  return [
    'You are a precise receipt & invoice OCR specialist.',
    'Extract purchase details from the uploaded receipt image.',
    'Return ONLY valid JSON with EXACTLY these keys (no extra keys, no markdown fences, no commentary):',
    JSON.stringify(
      {
        productName: null, brand: null, merchant: null, category: null,
        purchaseType: null, purchaseDate: null, amount: null, currency: null,
        quantity: null, tax: null, discount: null, paymentMethod: null,
        orderId: null, invoiceNumber: null, serialNumber: null, modelNumber: null,
        returnPeriodDays: null, returnDeadline: null, warrantyStart: null,
        warrantyEnd: null, warrantyMonths: null, warrantyType: null, notes: null
      },
      null,
      2
    ),
    'RULES:',
    '- The uploaded image is the ONLY source of truth.',
    '- NEVER guess, assume, predict, or invent missing information.',
    '- If a field is not visible or readable in the image, return null for it.',
    '- productName: the purchased item name exactly as printed.',
    '- merchant: the store / merchant name exactly as printed.',
    '- amount: the grand total actually paid (number, e.g. 127.14).',
    '- purchaseDate: purchase date as YYYY-MM-DD.',
    '- currency: ISO code (PKR, USD, INR, EUR, GBP) only if printed, else null.',
    '- category / purchaseType / quantity / tax / discount / paymentMethod / orderId / invoiceNumber / serialNumber / modelNumber: only if printed.',
    '- returnPeriodDays: only if the receipt prints a return window (e.g. "30 days").',
    '- returnDeadline / warrantyStart / warrantyEnd: only if printed on the receipt, as YYYY-MM-DD.',
    '- warrantyMonths / warrantyType: only if printed.',
    '- notes: one short sentence about a warranty/return policy ONLY if printed.',
    '- Do NOT calculate, infer, or use any external knowledge or defaults.',
    '- Do NOT invent values to make the JSON look complete.'
  ].join('\n') + (ocrText
    ? `\n\nOCR TEXT extracted from the same image (use it only to confirm what is visible, never to invent values):\n${ocrText.slice(0, 4000)}`
    : '');
}

class AiVisionService {
  /**
   * Public config snapshot (used by /api/ai/status for the UI indicator)
   */
  static getConfig() {
    const config = getConfig();
    return {
      provider: config.provider,
      enabled: config.provider === 'openai' ? Boolean(config.openaiApiKey) : Boolean(config.googleApiKey),
      model: config.provider === 'openai' ? config.openaiModel : config.geminiModel
    };
  }

  /**
   * Strict scanner analysis (scanner.md + Task 5 spec). Full pipeline:
   *
   *   1. Preprocess the ACTUAL uploaded image with sharp (resize, grayscale,
   *      normalize, sharpen, EXIF orientation) — better OCR & vision results.
   *   2. Run real Tesseract OCR on the preprocessed image -> raw OCR text.
   *   3. Send the image AND the OCR text to the vision LLM with the strict
   *      23-field prompt (only what is visible, null for anything missing).
   *   4. Validate the extracted fields against the OCR text (e.g. the grand
   *      total must match a TOTAL line; product/merchant must appear in OCR).
   *
   * Never guesses or invents data. Throws on: no image, missing API key,
   * AI API error, empty response, or invalid JSON — errors surface to the
   * user instead of returning fake purchase data.
   */
  static async analyzeStrict({ imageBase64 = '', mimeType = 'image/jpeg', filename = 'receipt_scan.jpg' } = {}) {
    const config = getConfig();
    if (!imageBase64) throw new Error('No image data provided.');
    if (config.provider !== 'openai' && !config.googleApiKey) {
      throw new Error('Gemini API key is not configured (GOOGLE_API_KEY missing in backend/.env).');
    }

    // 1. Preprocess the actual image with sharp
    let processedBase64 = imageBase64;
    let processedMime = mimeType || 'image/jpeg';
    try {
      const src = Buffer.from(imageBase64, 'base64');
      const meta = await sharp(src).metadata();
      const targetWidth = Math.min(1600, Math.max(1200, meta.width || 1400));
      const processed = await sharp(src)
        .rotate() // apply EXIF orientation
        .resize({ width: targetWidth, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen()
        .jpeg({ quality: 92 })
        .toBuffer();
      processedBase64 = processed.toString('base64');
      processedMime = 'image/jpeg';
      console.log(`[Scanner] Image preprocessed: ${meta.width}x${meta.height} -> ${targetWidth}px grayscale JPEG.`);
    } catch (preErr) {
      console.warn('[Scanner] sharp preprocessing failed, using original image:', preErr.message);
    }

    // 2. Real Tesseract OCR on the preprocessed image
    let ocrText = '';
    try {
      ocrText = await AiVisionService.ocrImage(processedBase64);
      console.log(`[Scanner] OCR extracted ${ocrText.length} characters.`);
    } catch (ocrErr) {
      console.warn('[Scanner] OCR failed (continuing with image only):', ocrErr.message);
    }

    // 3. Send the actual image + OCR text to the vision LLM
    let text = '';
    let aiEngine = config.provider === 'openai' ? 'openai' : 'gemini';
    let aiFailureReason = '';

    try {
      if (config.provider === 'openai') {
        if (!config.openaiApiKey) throw new Error('OpenAI API key is not configured (OPENAI_API_KEY missing in backend/.env).');
        console.log('[Scanner] Sending image + OCR text to OpenAI-compatible vision...');
        const res = await fetch(`${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openaiApiKey}`
          },
          body: JSON.stringify({
            model: config.openaiModel,
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: buildStrictPrompt(ocrText) },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Analyze this receipt image.' },
                  { type: 'image_url', image_url: { url: `data:${processedMime};base64,${processedBase64}` } }
                ]
              }
            ],
            max_tokens: 2048
          })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`AI vision API error ${res.status}: ${errText.slice(0, 300)}`);
        }
        const data = await res.json();
        text = data?.choices?.[0]?.message?.content || '';
      } else {
        console.log('[Scanner] Sending image + OCR text to Gemini Vision...');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${encodeURIComponent(config.googleApiKey)}`;
        const res = await fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
            parts: [
                { text: buildStrictPrompt(ocrText) },
                { inline_data: { mime_type: processedMime, data: processedBase64 } }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json'
            }
          })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
        }
        const data = await res.json();
        text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      console.log('[Scanner] AI vision response received.');
      if (!text || !text.trim()) {
        throw new Error('AI returned an empty response. Please try again.');
      }
    } catch (llmErr) {
      // Graceful fallback: when the vision LLM is unavailable (quota, outage),
      // return the REAL OCR-derived fields instead of failing or inventing
      // data. The review screen still lets the user edit anything.
      aiFailureReason = llmErr.message || 'vision LLM unavailable';
      console.warn(`[Scanner] Vision LLM failed (${aiFailureReason}) — falling back to OCR-only extraction.`);
      const ocrParsed = AiReceiptParser.parseReceiptText(ocrText, filename);
      const fallback = {
        productName: ocrParsed.productName,
        brand: ocrParsed.brand,
        merchant: ocrParsed.storeName,
        category: ocrParsed.category,
        purchaseType: null,
        purchaseDate: ocrParsed.purchaseDate,
        amount: ocrParsed.price,
        currency: ocrParsed.currency,
        quantity: ocrParsed.items && ocrParsed.items.length ? ocrParsed.items.reduce((s, it) => s + (it.quantity || 1), 0) : null,
        tax: null,
        discount: null,
        paymentMethod: ocrParsed.paymentMethod,
        orderId: null,
        invoiceNumber: ocrParsed.invoiceNumber,
        serialNumber: ocrParsed.serialNumber,
        modelNumber: ocrParsed.modelNumber,
        returnPeriodDays: ocrParsed.returnPeriodDays,
        returnDeadline: null,
        warrantyStart: null,
        warrantyEnd: null,
        warrantyMonths: ocrParsed.warrantyMonths,
        warrantyType: ocrParsed.warrantyType,
        notes: ocrParsed.notes,
        aiEngine: 'ocr',
        rawOcrText: ocrText,
        aiNotice: `AI vision unavailable (${aiFailureReason.slice(0, 120)}). Used local OCR — verify the details before saving.`
      };
      for (const numKey of ['amount', 'quantity', 'returnPeriodDays', 'warrantyMonths']) {
        if (fallback[numKey] !== null && fallback[numKey] !== undefined) {
          const n = parseFloat(fallback[numKey]);
          fallback[numKey] = isNaN(n) ? null : n;
        }
      }
      fallback.warrantyType = AiVisionService.normalizeWarrantyType(fallback.warrantyType);
      fallback.category = AiVisionService.normalizeCategory(fallback.category);
      fallback.purchaseType = AiVisionService.normalizePurchaseType(fallback.purchaseType);
      fallback.currency = AiVisionService.normalizeCurrency(fallback.currency);
      return fallback;
    }

    // Safely parse JSON (strip markdown fences / prose, keep only first object)
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    if (!cleaned.startsWith('{')) {
      const objStart = cleaned.indexOf('{');
      const objEnd = cleaned.lastIndexOf('}');
      if (objStart !== -1 && objEnd > objStart) {
        cleaned = cleaned.slice(objStart, objEnd + 1);
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error('AI returned invalid JSON. Please try again.');
    }
    console.log('[Scanner] JSON parsed successfully.');

    // Keep ONLY the strict schema keys; anything missing becomes null
    const result = {};
    for (const key of STRICT_SCHEMA_KEYS) {
      const v = parsed[key];
      result[key] = v !== undefined && v !== null && v !== '' ? v : null;
    }
    for (const numKey of ['amount', 'quantity', 'tax', 'discount', 'returnPeriodDays', 'warrantyMonths']) {
      if (result[numKey] !== null) {
        const n = parseFloat(String(result[numKey]).replace(/[^\d.-]/g, ''));
        result[numKey] = isNaN(n) ? null : n;
      }
    }

    // 4. Validate extracted values against the real OCR text
    if (ocrText) {
      const ocrLower = ocrText.toLowerCase();
      // 4a. amount must match a printed TOTAL line in the OCR text
      if (result.amount === null) {
        result.amount = AiVisionService.extractTotalFromOcr(ocrText);
      }
      // 4b. product / merchant should appear (case-insensitive) in the OCR text;
      //     if the AI invented them they won't be there -> null them out.
      const ocrWords = ocrLower.split(/\s+/);
      const fuzzyInOcr = (value) => {
        if (!value) return false;
        const words = String(value).toLowerCase().split(/\s+/).filter(w => w.length >= 4);
        if (!words.length) return true;
        return words.some(w => ocrLower.includes(w));
      };
      if (!fuzzyInOcr(result.productName) && result.productName) {
        console.warn(`[Scanner] productName "${result.productName}" not found in OCR text — setting null.`);
        result.productName = null;
      }
      if (!fuzzyInOcr(result.merchant) && result.merchant) {
        console.warn(`[Scanner] merchant "${result.merchant}" not found in OCR text — setting null.`);
        result.merchant = null;
      }
    }

    // Normalize extracted values to the values the existing Purchase model
    // accepts (its enums), so a confirmed scan always saves to MongoDB instead
    // of failing validation. Never invents values — only maps detected text.
    result.warrantyType = AiVisionService.normalizeWarrantyType(result.warrantyType);
    result.category = AiVisionService.normalizeCategory(result.category);
    result.purchaseType = AiVisionService.normalizePurchaseType(result.purchaseType);
    result.currency = AiVisionService.normalizeCurrency(result.currency);

    result.aiEngine = config.provider === 'openai' ? 'openai' : 'gemini';
    result.rawOcrText = ocrText;
    return result;
  }

  /**
   * Map a detected warranty type to the Purchase model's enum values:
   * Manufacturer, Extended, Store / Retailer, Lifetime, Credit Card Protected,
   * None. Anything unrecognized returns null (not detected).
   */
  static normalizeWarrantyType(value) {
    if (!value) return null;
    const v = String(value).toLowerCase();
    if (/manufacturer|standard|factory|official/.test(v)) return 'Manufacturer';
    if (/extended|plus|pro|accidental/.test(v)) return 'Extended';
    if (/store|retailer|seller|shop/.test(v)) return 'Store / Retailer';
    if (/lifetime|life ?time/.test(v)) return 'Lifetime';
    if (/credit|card|bank/.test(v)) return 'Credit Card Protected';
    if (/none|no warranty|not covered/.test(v)) return 'None';
    return null;
  }

  /**
   * Map a detected category to the Purchase model's category enum. Unknown
   * categories return null (not detected) instead of inventing one.
   */
  static normalizeCategory(value) {
    if (!value) return null;
    const valid = ['Electronics', 'Home Appliances', 'Gadgets', 'Vehicles', 'Furniture', 'Fashion', 'Office', 'Sports', 'Sports & Fitness', 'Food & Groceries', 'Food & Beverages', 'Other'];
    const v = String(value).trim();
    const exact = valid.find(c => c.toLowerCase() === v.toLowerCase());
    if (exact) return exact;
    const lower = v.toLowerCase();
    if (/electronics|computer|laptop|phone|tv|audio|headphone|tablet|console/.test(lower)) return 'Electronics';
    if (/fridge|refrigerator|washing|appliance|vacuum|oven|microwave/.test(lower)) return 'Home Appliances';
    if (/gadget|smartwatch|wearable|drone|camera/.test(lower)) return 'Gadgets';
    if (/furniture|bed|sofa|chair|table|desk|mattress/.test(lower)) return 'Furniture';
    if (/fashion|clothing|shoe|apparel|wear/.test(lower)) return 'Fashion';
    if (/office|stationery|supplies/.test(lower)) return 'Office';
    if (/sport|fitness|gym|bike|exercise/.test(lower)) return 'Sports & Fitness';
    if (/grocery|food|supermarket|produce/.test(lower)) return 'Food & Groceries';
    if (/beverage|coffee|drink|restaurant/.test(lower)) return 'Food & Beverages';
    if (/car|vehicle|auto|motorcycle/.test(lower)) return 'Vehicles';
    return null;
  }

  /**
   * Map a detected purchase type to the Purchase model enum (ONLINE/OFFLINE).
   */
  static normalizePurchaseType(value) {
    if (!value) return null;
    return String(value).toUpperCase().includes('OFFLINE') || /in.store|physical|retail store/.test(String(value).toLowerCase())
      ? 'OFFLINE'
      : 'ONLINE';
  }

  /**
   * Normalize a detected currency to an ISO code the app understands. Returns
   * null if no currency symbol/code is visible on the receipt (never guesses).
   */
  static normalizeCurrency(value) {
    if (!value) return null;
    const v = String(value).trim().toUpperCase();
    if (v.includes('PKR') || v.includes('RS') || v.includes('₨') || v.includes('RUPEE')) return 'PKR';
    if (v.includes('INR') || v.includes('₹')) return 'INR';
    if (v.includes('USD') || v.includes('$')) return 'USD';
    if (v.includes('EUR') || v.includes('€')) return 'EUR';
    if (v.includes('GBP') || v.includes('£')) return 'GBP';
    if (v.includes('AED') || v.includes('د')) return 'AED';
    return null;
  }

  /**
   * Pull the printed grand total out of OCR text. Looks for a TOTAL / GRAND
   * TOTAL / BALANCE line first, then any currency amount on the receipt.
   * Returns null when nothing clearly printable is found (never invents one).
   */
  static extractTotalFromOcr(ocrText) {
    if (!ocrText) return null;
    const lines = ocrText.split(/\n/).map(l => l.trim()).filter(Boolean);
    // 1. Prefer an explicit total line
    for (const line of lines) {
      if (/total|grand|balance|amount due|net amount/i.test(line)) {
        const match = line.match(/([\d,]+(?:\.\d{2})?)/);
        if (match) {
          const n = parseFloat(match[1].replace(/,/g, ''));
          if (!isNaN(n) && n > 0) return n;
        }
      }
    }
    // 2. Fall back to the last currency amount printed (bottom of receipt)
    const amounts = [];
    for (const line of lines) {
      const m = line.match(/(?:₨|Rs\.?|PKR|USD|\$|€|£|₹)\s*([\d,]+(?:\.\d{2})?)/i);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(n) && n > 0) amounts.push(n);
      }
    }
    return amounts.length ? amounts[amounts.length - 1] : null;
  }

  /**
   * Main entry point — parse a receipt into a structured purchase object.
   * Tries, in order:
   *   1. AI vision (Gemini / OpenAI-compatible) when a key is configured
   *   2. Local OCR (Tesseract.js, no API key) for real receipt images
   *   3. Rule-based parser (filename / pasted text) as the last resort
   */
  static async parseReceipt({ imageBase64 = '', mimeType = 'image/jpeg', filename = 'receipt_scan.jpg', rawText = '' } = {}) {
    const config = getConfig();
    const hasImage = Boolean(imageBase64);
    const hasKey = config.provider === 'openai' ? config.openaiApiKey : config.googleApiKey;
    let aiFailureReason = '';

    // 1. AI vision provider (when a key is configured)
    if (hasKey) {
      try {
        let aiResult = null;
        if (config.provider === 'openai') {
          aiResult = await scanWithOpenAiCompat(imageBase64, mimeType, filename, rawText, config);
        } else {
          aiResult = await scanWithGemini(imageBase64, mimeType, filename, rawText, config);
        }

        if (aiResult) {
          // Guard against "successful" calls that returned no usable data
          if (!AiVisionService.hasExtractionSubstance(aiResult)) {
            throw new Error('AI returned no usable extraction (empty response).');
          }
          return AiReceiptParser.enrichWithRetailerKnowledge({
            ...aiResult,
            receiptFileName: filename,
            rawExtractedText: rawText || ''
          });
        }
      } catch (err) {
        aiFailureReason = err.message || 'AI scan failed';
        console.warn(`[AiVision] ${config.provider} scan failed:`, aiFailureReason);
      }
    } else if (hasImage) {
      console.warn('[AiVision] No AI API key configured — using local OCR fallback.');
    }

    // 2. Local OCR (Tesseract.js) — works offline, no API key, reads real images
    if (hasImage) {
      const ocrText = await AiVisionService.ocrImage(imageBase64);
      if (ocrText) {
        const parsed = AiReceiptParser.parseReceiptText(ocrText, filename);
        parsed.aiEngine = 'ocr';
        parsed.rawExtractedText = ocrText;
        parsed.aiNotice = aiFailureReason
          ? `AI vision unavailable (${aiFailureReason.slice(0, 100)}) — used local OCR. Verify the details before saving.`
          : 'Local OCR scan (no AI key configured) — verify the details before saving.';
        return parsed;
      }
    }

    // 3. Rule-based last resort (filename / pasted text)
    const parsed = AiReceiptParser.parseReceiptText(rawText || (hasImage ? filename : ''), filename);
    parsed.aiEngine = 'rules';
    parsed.aiNotice = aiFailureReason
      ? `AI unavailable (${aiFailureReason.slice(0, 120)}) — used rule-based scan.`
      : 'Rule-based scan (add an AI API key in backend/.env for AI vision)';
    return parsed;
  }

  /**
   * Run local OCR on a base64 image and return the extracted text.
   *
   * Images are normalized through sharp first (any input format → clean
   * grayscale PNG at a readable size). This fixes two real-world problems:
   *   1. Tesseract/leptonica cannot decode some encoders' PNGs (e.g. Chrome
   *      headless screenshots) — re-encoding via sharp solves it.
   *   2. Phone photos benefit from contrast normalization + upscaling.
   */
  static async ocrImage(imageBase64) {
    if (!imageBase64) return '';
    try {
      let buffer = Buffer.from(imageBase64, 'base64');

      // Decode metadata to decide whether to upscale
      try {
        const meta = await sharp(buffer).metadata();
        const target = Math.min(2200, Math.max(1400, (meta.width || 800) * 2));
        buffer = await sharp(buffer)
          .resize({ width: target, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .png()
          .toBuffer();
      } catch (decodeErr) {
        console.warn('[AiVision] sharp normalize failed, OCR raw buffer:', decodeErr.message);
      }

      const { data } = await Tesseract.recognize(buffer, 'eng', { logger: () => {} });
      return (data && data.text ? data.text : '').trim();
    } catch (err) {
      console.warn('[AiVision] OCR failed:', err.message);
      return '';
    }
  }

  /**
   * True when the AI actually extracted real content (not a template echo).
   */
  static hasExtractionSubstance(result) {
    return Boolean(
      (result.productName && result.productName !== 'Purchased Item') ||
      result.price > 0 ||
      (Array.isArray(result.items) && result.items.length > 0) ||
      result.serialNumber ||
      result.invoiceNumber ||
      (result.storeName && result.storeName !== 'Retail Merchant')
    );
  }

  /**
   * Extract a JSON object from an LLM response (strips fences / prose).
   */
  static parseJsonFromLlm(text, engine) {
    if (!text) throw new Error('Empty AI response.');

    let cleaned = text.trim();
    // Strip markdown code fences if present
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    // Extract the first {...} block as a last resort
    if (!cleaned.startsWith('{')) {
      const objStart = cleaned.indexOf('{');
      const objEnd = cleaned.lastIndexOf('}');
      if (objStart !== -1 && objEnd > objStart) {
        cleaned = cleaned.slice(objStart, objEnd + 1);
      }
    }

    const parsed = JSON.parse(cleaned);
    return AiVisionService.normalize(parsed, engine);
  }

  /**
   * Normalize AI output into the app's canonical purchase shape.
   * Handles the field-name variants LLMs commonly return (e.g.
   * description/serial_number instead of name/serialNumber) and derives
   * missing top-level fields from the extracted line items.
   */
  static normalize(raw, engine) {
    const num = (v, fallback = 0) => {
      const n = parseFloat(v);
      return isNaN(n) ? fallback : n;
    };
    const pick = (obj, ...keys) => {
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };

    // Normalize line items (accept common LLM field variants)
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    const items = rawItems
      .map(it => ({
        name: pick(it, 'name', 'description', 'item', 'productName', 'product_name') || '',
        price: num(pick(it, 'price', 'unit_price', 'amount'), 0),
        quantity: num(pick(it, 'quantity', 'qty', 'count'), 1),
        serialNumber: pick(it, 'serialNumber', 'serial_number', 'serial', 'sn', 'imei') || ''
      }))
      .filter(it => it.name || it.price > 0);

    // Top-level fields, with fallbacks derived from the items
    let productName = pick(raw, 'productName', 'product_name', 'name', 'item', 'product');
    if (!productName && items.length) productName = items[0].name;

    let price = num(pick(raw, 'price', 'total', 'amount', 'grand_total', 'total_amount'), 0);
    if (!price && items.length) {
      price = items.reduce((sum, it) => sum + it.price * (it.quantity || 1), 0);
    }
    price = Math.round(price * 100) / 100;

    let serialNumber = pick(raw, 'serialNumber', 'serial_number', 'serial', 'sn', 'imei') || '';
    if (!serialNumber) {
      const withSerial = items.find(it => it.serialNumber);
      if (withSerial) serialNumber = withSerial.serialNumber;
    }

    const result = {
      productName: productName || null,
      brand: pick(raw, 'brand', 'manufacturer') || null,
      storeName: pick(raw, 'storeName', 'store_name', 'merchant', 'vendor') || null,
      purchaseDate: pick(raw, 'purchaseDate', 'date', 'purchase_date', 'bill_date') || null,
      price: price || null,
      currency: pick(raw, 'currency') || 'PKR',
      category: pick(raw, 'category') || null,
      warrantyMonths: num(pick(raw, 'warrantyMonths', 'warranty_months'), 0) || null,
      warrantyType: pick(raw, 'warrantyType', 'warranty_type') || null,
      returnPeriodDays: num(pick(raw, 'returnPeriodDays', 'return_period_days', 'return_days'), 0) || null,
      serialNumber,
      modelNumber: pick(raw, 'modelNumber', 'model_number', 'model') || null,
      invoiceNumber: pick(raw, 'invoiceNumber', 'invoice_number', 'invoice', 'receiptNumber', 'receipt') || null,
      paymentMethod: pick(raw, 'paymentMethod', 'payment_method', 'payment') || null,
      items,
      notes: pick(raw, 'notes', 'note', 'policy_notes') || null,
      confidenceScore: Math.min(1, Math.max(0, num(pick(raw, 'confidenceScore', 'confidence', 'score'), 0.85))),
      aiEngine: engine,
      aiExtracted: true
    };
    return result;
  }
}

module.exports = AiVisionService;
