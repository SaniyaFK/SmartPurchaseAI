const mongoose = require('mongoose');

/**
 * RagDocument — persisted RAG text chunks for the Hybrid RAG chatbot.
 *
 * One document per purchase (sourceType='purchase') and optionally one per
 * line-item within a multi-item bill (sourceType='item').
 *
 * At startup RagIndexService loads these into the in-memory Map so that
 * similarity search is purely in-memory (no Atlas Vector Search required).
 */
const RagDocumentSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    // 'purchase' | 'item'
    sourceType: {
      type: String,
      required: true,
      enum: ['purchase', 'item'],
      default: 'purchase'
    },
    // MongoDB _id of the originating Purchase document (as string)
    sourceId: {
      type: String,
      required: true
    },
    // Human-readable text chunk that was TF-IDF encoded
    text: {
      type: String,
      required: true
    },
    // TF-IDF vector stored as {term: weight} plain object
    // Stored as Mixed so Mongoose doesn't try to coerce it
    tfIdfVector: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    // Lightweight metadata for source attribution in the UI
    metadata: {
      productName: String,
      brand: String,
      merchant: String,
      category: String,
      purchaseDate: Date,
      amount: Number,
      currency: String,
      warrantyEnd: Date,
      returnDeadline: Date,
      status: String,
      serialNumber: String,
      invoiceNumber: String
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    // We manage updatedAt manually so we can also update it in-memory
    timestamps: false,
    // Compound unique index: one doc per (sourceId, userId)
    // ensures upserts work correctly
    collection: 'rag_documents'
  }
);

// Compound unique index — guarantees idempotent upserts
RagDocumentSchema.index({ sourceId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('RagDocument', RagDocumentSchema);
