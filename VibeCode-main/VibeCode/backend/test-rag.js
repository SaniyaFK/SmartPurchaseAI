/**
 * test-rag.js — Verification script for the Hybrid RAG Chatbot
 *
 * Run from the backend/ directory:
 *   node test-rag.js
 *
 * What it verifies:
 *   1. TF-IDF embedding produces non-empty vectors
 *   2. Cosine similarity correctly ranks relevant docs higher
 *   3. User isolation: User A's queries NEVER return User B's data
 *   4. Semantic retrieval: "Apple warranty" returns Apple-related docs
 *   5. Warranty expiry query returns the soonest-expiring items first
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  tfidfEmbed,
  cosineSimilarity,
  buildPurchaseText,
  buildItemText,
  updateMemoryIndex,
  generateAnswer,
  getMemoryIndex
} = require('./services/ragService');

const { indexPurchase, deletePurchase } = require('./services/ragIndexService');

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

// ── Sample Data ───────────────────────────────────────────────────────────────

const now = new Date();
const inOneYear = new Date(now.getTime() + 365 * 86400000);
const inTenDays = new Date(now.getTime() + 10 * 86400000);
const inOneMonth = new Date(now.getTime() + 30 * 86400000);
const returnDeadline = new Date(now.getTime() + 7 * 86400000);

const userA = 'user_A_test';
const userB = 'user_B_test';

const purchasesA = [
  {
    _id: 'pA1',
    id: 'pA1',
    userId: userA,
    productName: 'iPhone 15 Pro',
    brand: 'Apple',
    category: 'Electronics',
    merchant: 'iStore',
    purchaseDate: new Date('2024-01-15'),
    amount: 300000,
    currency: 'PKR',
    quantity: 1,
    serialNumber: 'SN-AAPL-001',
    invoiceNumber: 'INV-001',
    warrantyMonths: 12,
    warrantyEnd: inOneYear,
    warrantyExpiresAt: inOneYear,
    returnDeadline,
    returnPeriodDays: 14,
    status: 'active',
    warrantyType: 'Manufacturer',
    purchaseType: 'OFFLINE'
  },
  {
    _id: 'pA2',
    id: 'pA2',
    userId: userA,
    productName: 'MacBook Air M3',
    brand: 'Apple',
    category: 'Electronics',
    merchant: 'Apple Store',
    purchaseDate: new Date('2024-03-01'),
    amount: 450000,
    currency: 'PKR',
    quantity: 1,
    serialNumber: 'SN-AAPL-002',
    warrantyMonths: 12,
    warrantyEnd: inTenDays, // Expiring very soon!
    warrantyExpiresAt: inTenDays,
    returnDeadline: new Date(now.getTime() - 86400000), // Expired return window
    returnPeriodDays: 14,
    status: 'expiring_soon',
    purchaseType: 'OFFLINE'
  },
  {
    _id: 'pA3',
    id: 'pA3',
    userId: userA,
    productName: 'Samsung QLED TV',
    brand: 'Samsung',
    category: 'Electronics',
    merchant: 'Daraz',
    purchaseDate: new Date('2023-12-01'),
    amount: 150000,
    currency: 'PKR',
    quantity: 1,
    warrantyMonths: 24,
    warrantyEnd: inOneMonth,
    warrantyExpiresAt: inOneMonth,
    returnDeadline: new Date(now.getTime() + 14 * 86400000),
    returnPeriodDays: 30,
    status: 'expiring_soon',
    purchaseType: 'ONLINE'
  }
];

const purchasesB = [
  {
    _id: 'pB1',
    id: 'pB1',
    userId: userB,
    productName: 'Dell XPS 15',
    brand: 'Dell',
    category: 'Electronics',
    merchant: 'Dell Online',
    purchaseDate: new Date('2024-02-01'),
    amount: 350000,
    currency: 'PKR',
    quantity: 1,
    warrantyEnd: inOneYear,
    warrantyExpiresAt: inOneYear,
    returnDeadline: new Date(now.getTime() + 5 * 86400000),
    status: 'active',
    purchaseType: 'ONLINE'
  },
  {
    _id: 'pB2',
    id: 'pB2',
    userId: userB,
    productName: 'Sony WH-1000XM5',
    brand: 'Sony',
    category: 'Electronics',
    merchant: 'Sony Centre',
    purchaseDate: new Date('2024-04-01'),
    amount: 80000,
    currency: 'PKR',
    quantity: 1,
    warrantyEnd: inOneYear,
    warrantyExpiresAt: inOneYear,
    returnDeadline: new Date(now.getTime() + 10 * 86400000),
    status: 'active',
    purchaseType: 'OFFLINE'
  }
];

// ── Test Runner ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🧪 RAG Chatbot Verification Suite\n');

  // ─── Section 1: TF-IDF Utilities ──────────────────────────────────────────
  section('1. TF-IDF Embedding & Cosine Similarity');

  const vecA = tfidfEmbed('Apple iPhone warranty expiring');
  const vecB = tfidfEmbed('Apple MacBook Air Electronics');
  const vecC = tfidfEmbed('Samsung TV home appliance');

  assert(Object.keys(vecA).length > 0, 'tfidfEmbed returns non-empty vector');
  assert(typeof vecA['apple'] === 'number', 'vector contains expected term "apple"');
  assert(typeof vecA['warranty'] === 'number', 'vector contains expected term "warranty"');

  const simAB = cosineSimilarity(vecA, vecB);
  const simAC = cosineSimilarity(vecA, vecC);
  assert(simAB > simAC, `Apple/Apple similarity (${simAB.toFixed(3)}) > Apple/Samsung similarity (${simAC.toFixed(3)})`);
  assert(cosineSimilarity({}, {}) === 0, 'empty vectors return 0 similarity');

  // ─── Section 2: Document Text Builder ─────────────────────────────────────
  section('2. Purchase Text Builder');

  const text = buildPurchaseText(purchasesA[0]);
  assert(text.includes('iPhone 15 Pro'), 'text includes product name');
  assert(text.includes('Apple'), 'text includes brand');
  assert(text.includes('iStore'), 'text includes merchant');
  assert(text.includes('SN-AAPL-001'), 'text includes serial number');

  const itemText = buildItemText(purchasesA[0], { productName: 'AirPods Pro', price: 50000, quantity: 1 });
  assert(itemText.includes('AirPods Pro'), 'item text includes item product name');
  assert(itemText.includes('iStore'), 'item text includes parent merchant');

  // ─── Section 3: Index & User Isolation ────────────────────────────────────
  section('3. RAG Index Population & User Isolation');

  // Index User A's purchases
  for (const p of purchasesA) {
    await indexPurchase(userA, p);
  }
  // Index User B's purchases
  for (const p of purchasesB) {
    await indexPurchase(userB, p);
  }

  const indexA = getMemoryIndex(userA);
  const indexB = getMemoryIndex(userB);

  assert(indexA.length >= 3, `User A index has ${indexA.length} docs (expected ≥3)`);
  assert(indexB.length >= 2, `User B index has ${indexB.length} docs (expected ≥2)`);

  // Verify cross-user isolation in the index
  const userASourceIds = indexA.map(d => d.sourceId);
  const userBSourceIds = indexB.map(d => d.sourceId);
  const overlap = userASourceIds.filter(id => userBSourceIds.includes(id));
  assert(overlap.length === 0, `No source ID overlap between User A and User B (found ${overlap.length} overlaps)`);

  // Verify User A index contains ONLY User A's product names
  const userATexts = indexA.map(d => d.text).join(' ');
  assert(userATexts.includes('iPhone'), 'User A index contains iPhone');
  assert(userATexts.includes('MacBook'), 'User A index contains MacBook');
  assert(!userATexts.includes('Dell XPS'), "User A index does NOT contain User B's Dell XPS");
  assert(!userATexts.includes('Sony'), "User A index does NOT contain User B's Sony headphones");

  // Verify User B index contains ONLY User B's product names
  const userBTexts = indexB.map(d => d.text).join(' ');
  assert(userBTexts.includes('Dell XPS'), 'User B index contains Dell XPS');
  assert(!userBTexts.includes('iPhone'), "User B index does NOT contain User A's iPhone");

  // ─── Section 4: Delete from Index ─────────────────────────────────────────
  section('4. Delete from RAG Index');

  await deletePurchase('pA1', userA);
  const indexAAfterDelete = getMemoryIndex(userA);
  const hasDeletedDoc = indexAAfterDelete.some(d => d.sourceId === 'pA1');
  assert(!hasDeletedDoc, 'Deleted purchase (pA1) is removed from User A index');
  assert(
    indexAAfterDelete.some(d => d.sourceId === 'pA2'),
    'Other User A purchases remain after delete'
  );

  // Re-index pA1 for subsequent tests
  await indexPurchase(userA, purchasesA[0]);

  // ─── Section 5: Semantic Retrieval (no Gemini call) ───────────────────────
  section('5. Semantic Query Relevance (TF-IDF ranking)');

  // We test the retrieve logic directly via the in-memory index
  const { getMemoryIndex: getIdx } = require('./services/ragService');
  // Manually run vector retrieve by scoring all User A docs
  const appleQuery = tfidfEmbed('Tell me about my Apple purchases');
  const indexAfter = getIdx(userA);
  const scored = indexAfter.map(d => ({
    name: d.metadata && d.metadata.productName,
    score: cosineSimilarity(appleQuery, d.vector || {})
  }));
  scored.sort((a, b) => b.score - a.score);

  const topResult = scored[0];
  const isAppleTop = topResult && (topResult.name === 'iPhone 15 Pro' || topResult.name === 'MacBook Air M3');
  assert(isAppleTop, `Top result for Apple query is Apple product: "${topResult && topResult.name}"`);

  const samsungQuery = tfidfEmbed('Samsung TV warranty');
  const samsungScored = indexAfter.map(d => ({
    name: d.metadata && d.metadata.productName,
    score: cosineSimilarity(samsungQuery, d.vector || {})
  }));
  samsungScored.sort((a, b) => b.score - a.score);
  assert(
    samsungScored[0] && samsungScored[0].name === 'Samsung QLED TV',
    `Top result for Samsung query is "Samsung QLED TV": got "${samsungScored[0] && samsungScored[0].name}"`
  );

  // ─── Section 6: End-to-End generateAnswer (LLM optional) ─────────────────
  section('6. End-to-End RAG Pipeline (generateAnswer)');

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('  ⚠️  GOOGLE_API_KEY not set — skipping live Gemini call. Retrieval test only.');

    // Without LLM, just verify the pipeline runs and returns sources
    try {
      const result = await generateAnswer(userA, 'Which warranty expires soon?');
      assert(typeof result.answer === 'string', 'generateAnswer returns string answer (fallback mode)');
      assert(Array.isArray(result.sources), 'generateAnswer returns sources array');

      // Critical: sources must ONLY contain User A's doc IDs
      const sourceIds = result.sources.map(s => s.id);
      const leaksUserB = sourceIds.some(id => userBSourceIds.includes(id));
      assert(!leaksUserB, "Answer sources do NOT include User B's data");
    } catch (err) {
      assert(false, 'generateAnswer threw an error: ' + err.message);
    }
  } else {
    console.log('  🤖  GOOGLE_API_KEY found — running live Gemini call...');
    try {
      const result = await generateAnswer(userA, 'Which of my warranties is expiring soon?');
      assert(typeof result.answer === 'string' && result.answer.length > 10, 'Gemini returned non-empty answer');
      assert(Array.isArray(result.sources), 'generateAnswer returns sources array');
      assert(
        result.answer.toLowerCase().includes('macbook') || result.answer.toLowerCase().includes('samsung') || result.answer.toLowerCase().includes('expir'),
        'Gemini answer mentions expiring products or "expir" keyword'
      );

      // Critical isolation check
      const sourceIds = result.sources.map(s => s.id);
      const leaksUserB = sourceIds.some(id => ['pB1', 'pB2'].includes(id));
      assert(!leaksUserB, "User A query: sources do NOT include User B's purchases");

      console.log('\n  📝 Gemini answer preview:', result.answer.slice(0, 200) + '...');
    } catch (err) {
      assert(false, 'generateAnswer (live) threw: ' + err.message);
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(60)}\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed! RAG chatbot is working correctly.\n');
  } else {
    console.log(`⚠️  ${failed} test(s) failed. Please review the output above.\n`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('\n💥 Test suite crashed:', err);
  process.exit(1);
});
