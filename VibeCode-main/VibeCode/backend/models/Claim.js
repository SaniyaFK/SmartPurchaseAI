const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  purchaseId: {
    type: String,
    required: true,
    index: true
  },
  productName: {
    type: String,
    required: true
  },
  brand: {
    type: String,
    default: ''
  },
  storeName: {
    type: String,
    default: ''
  },
  serialNumber: {
    type: String,
    default: ''
  },
  invoiceNumber: {
    type: String,
    default: ''
  },
  purchaseDate: {
    type: Date
  },
  amount: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  issueCategory: {
    type: String,
    default: 'Hardware Defect / Operational Failure'
  },
  issueDescription: {
    type: String,
    default: 'Device ceased operating under normal usage conditions.'
  },
  desiredResolution: {
    type: String,
    default: 'Official Warranty Repair / Replacement'
  },
  letterSubject: {
    type: String,
    default: ''
  },
  letterContent: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['submitted', 'in_review', 'approved', 'rejected'],
    default: 'submitted',
    index: true
  },
  resolutionNote: {
    type: String,
    default: ''
  },
  submittedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

claimSchema.index({ userId: 1, submittedAt: -1 });
claimSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.models.Claim || mongoose.model('Claim', claimSchema);
