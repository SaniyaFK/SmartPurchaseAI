const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  purchaseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
    index: true
  },
  originalFileName: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    default: 0
  },
  mimeType: {
    type: String,
    default: 'image/jpeg'
  },
  ocrExtractedText: {
    type: String,
    default: ''
  },
  ocrConfidenceScore: {
    type: Number,
    default: 0
  },
  merchantDetected: {
    type: String,
    default: ''
  },
  totalDetected: {
    type: Number,
    default: 0
  },
  summary: {
    type: String,
    default: null
  },
  translations: {
    type: Map,
    of: String,
    default: {}
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

receiptSchema.index({ userId: 1, uploadedAt: -1 });

module.exports = mongoose.models.Receipt || mongoose.model('Receipt', receiptSchema);
