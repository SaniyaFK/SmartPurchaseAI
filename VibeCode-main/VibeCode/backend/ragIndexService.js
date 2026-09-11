/**
 * ragIndexService.js — RAG Synchronisation Layer
 *
 * Keeps RAG documents in sync with MongoDB purchases.
 * Called by PurchaseService after every create/update/delete.
 *
 * Storage strategy:
 *   1. In-memory Map (via ragService.updateMemoryIndex) — fast retrieval.
 *   2. RagDocument collection in MongoDB — persistent across restarts.
 *
 * On server start, loadAllUsersFromDB() populates the in-memory index
 * from the persisted RagDocument records.
 */

const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const RagDocument = require('../models/RagDocument');
const {
  tfidfEmbed,
  buildPurchaseText,
  buildItemText,
  updateMemoryIndex,
  removeFromMemoryIndex,
  getMemoryIndex
} = require('./ragService');

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Build all RAG doc records for a single Purchase object.
 * Returns an array of plain objects (not Mongoose docs).
 */
function buildDocsForPurchase(userId, purchase) {
  const purchaseId =
    (purchase._id && purchase._id.toString) ? purchase._id.toString() : String(purchase._id || purchase.id);

  const docs = [];

  // 1. Top-level purchase chunk
  const purchaseText = buildPurchaseText(purchase);
  docs.push({
    userId,
    sourceType: 'purchase',
    sourceId: purchaseId,
    text: purchaseText,
    vector: tfidfEmbed(purchaseText),
    metadata: {
      productName: purchase.productName,
      brand: purchase.brand,
      merchant: purchase.merchant || purchase.storeName,
      category: purchase.category,
      purchaseDate: purchase.purchaseDate,
      amount: purchase.amount || purchase.price,
      currency: purchase.currency,
      warrantyEnd: purchase.warrantyEnd || purchase.warrantyExpiresAt,
      returnDeadline: purchase.returnDeadline,
      status: purchase.status,
      serialNumber: purchase.serialNumber,
      invoiceNumber: purchase.invoiceNumber
    }
  });

  // 2. Per-item chunks from multi-product bills (items[] array)
  const items = Array.isArray(purchase.items) ? purchase.items : [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemText = buildItemText(purchase, item);
    // sourceId for items: "<purchaseId>_item_<index>" — still unique per bill
    const itemSourceId = `${purchaseId}_item_${i}`;
    docs.push({
      userId,
      sourceType: 'item',
      sourceId: itemSourceId,
      text: itemText,
      vector: tfidfEmbed(itemText),
      metadata: {
        productName: item.productName,
        brand: item.brand,
        merchant: purchase.merchant || purchase.storeName,
        category: item.category,
        purchaseDate: purchase.purchaseDate,
        amount: item.price,
        currency: purchase.currency,
        warrantyEnd: null,
        returnDeadline: null,
        status: null,
        serialNumber: item.serialNumber,
        invoiceNumber: null
      }
    });
  }

  return docs;
}

/**
 * Persist one array of RAG docs to MongoDB (upsert by sourceId+userId).
 * Non-fatal: logs warnings but does not throw.
 */
async function persistDocsToDB(docs) {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const ops = docs.map(doc => ({
      updateOne: {
        filter: { sourceId: doc.sourceId, userId: doc.userId },
        update: {
          $set: {
            sourceType: doc.sourceType,
            text: doc.text,
            tfIdfVector: doc.vector,
            metadata: doc.metadata,
            updatedAt: new Date()
          }
        },
        upsert: true
      }
    }));
    if (ops.length > 0) {
      await RagDocument.bulkWrite(ops, { ordered: false });
    }
  } catch (err) {
    console.warn('[RAGIndex] MongoDB persist warning:', err.message);
  }
}

/**
 * Remove all RagDocument records for a given sourceId prefix + userId from DB.
 */
async function deleteDocsFromDB(purchaseId, userId) {
  if (mongoose.connection.readyState !== 1) return;
  try {
    // Matches both the purchase-level sourceId and any item-level sourceIds
    await RagDocument.deleteMany({
      userId,
      $or: [
        { sourceId: purchaseId },
        { sourceId: { $regex: `^${purchaseId}_item_` } }
      ]
    });
  } catch (err) {
    console.warn('[RAGIndex] MongoDB delete warning:', err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Index (create or update) RAG documents for one purchase.
 * Safe to call after create OR update.
 *
 * @param {string} userId
 * @param {object} purchase  — plain purchase object or Mongoose doc
 */
async function indexPurchase(userId, purchase) {
  try {
    const newDocs = buildDocsForPurchase(userId, purchase);

    // Update in-memory index for this user
    const existing = getMemoryIndex(userId);
    const purchaseId =
      (purchase._id && purchase._id.toString) ? purchase._id.toString() : String(purchase._id || purchase.id);

    // Remove old docs for this purchase (both purchase-level and item-level)
    const filtered = existing.filter(
      d => d.sourceId !== purchaseId && !d.sourceId.startsWith(`${purchaseId}_item_`)
    );

    updateMemoryIndex(userId, [...filtered, ...newDocs]);

    // Persist to MongoDB asynchronously (non-blocking)
    persistDocsToDB(newDocs).catch(() => {});
  } catch (err) {
    console.warn('[RAGIndex] indexPurchase error:', err.message);
  }
}

/**
 * Remove RAG documents for a deleted purchase.
 *
 * @param {string} purchaseId
 * @param {string} userId
 */
async function deletePurchase(purchaseId, userId) {
  try {
    removeFromMemoryIndex(userId, purchaseId);
    // Also remove item-level docs from memory
    const existing = getMemoryIndex(userId);
    updateMemoryIndex(
      userId,
      existing.filter(d => !d.sourceId.startsWith(`${purchaseId}_item_`))
    );

    // Remove from MongoDB
    deleteDocsFromDB(purchaseId, userId).catch(() => {});
  } catch (err) {
    console.warn('[RAGIndex] deletePurchase error:', err.message);
  }
}

/**
 * Full re-index for a user: fetch all purchases → rebuild all RAG docs.
 * Used at startup and by the /api/chat/rebuild endpoint.
 *
 * @param {string} userId
 */
async function rebuildUserIndex(userId) {
  try {
    if (mongoose.connection.readyState !== 1) return;

    const purchases = await Purchase.find({ userId }).lean();
    const allDocs = [];

    for (const p of purchases) {
      p.id = p._id.toString();
      const docs = buildDocsForPurchase(userId, p);
      allDocs.push(...docs);
    }

    updateMemoryIndex(userId, allDocs);

    // Persist to MongoDB
    await persistDocsToDB(allDocs);

    console.log(`[RAGIndex] Rebuilt index for user ${userId}: ${allDocs.length} doc(s)`);
  } catch (err) {
    console.warn('[RAGIndex] rebuildUserIndex error:', err.message);
  }
}

/**
 * Load ALL users' RAG documents from MongoDB into memory on server start.
 * Called once after connectDB() resolves.
 */
async function loadAllUsersFromDB() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const allDocs = await RagDocument.find({}).lean();
    const grouped = {};

    for (const doc of allDocs) {
      if (!grouped[doc.userId]) grouped[doc.userId] = [];
      grouped[doc.userId].push({
        docId: doc._id.toString(),
        sourceType: doc.sourceType,
        sourceId: doc.sourceId,
        text: doc.text,
        vector: doc.tfIdfVector || {},
        metadata: doc.metadata || {}
      });
    }

    for (const [userId, docs] of Object.entries(grouped)) {
      updateMemoryIndex(userId, docs);
    }

    const userCount = Object.keys(grouped).length;
    const docCount = allDocs.length;
    console.log(
      `[RAGIndex] Loaded ${docCount} RAG doc(s) for ${userCount} user(s) from MongoDB.`
    );
  } catch (err) {
    console.warn('[RAGIndex] loadAllUsersFromDB warning:', err.message);
  }
}

module.exports = {
  indexPurchase,
  deletePurchase,
  rebuildUserIndex,
  loadAllUsersFromDB
};
