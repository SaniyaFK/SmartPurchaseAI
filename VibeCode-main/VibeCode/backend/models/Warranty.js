const mongoose = require('mongoose');

const warrantySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  purchaseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
    required: true,
    index: true
  },
  productName: {
    type: String,
    required: true,
    index: true
  },
  brand: {
    type: String,
    default: ''
  },
  provider: {
    type: String,
    default: 'Manufacturer'
  },
  warrantyType: {
    type: String,
    enum: ['MANUFACTURER', 'EXTENDED', 'RETAILER', 'LIFETIME', 'CREDIT_CARD'],
    default: 'MANUFACTURER',
    index: true
  },
  warrantyDurationMonths: {
    type: Number,
    required: true,
    default: 12
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true,
    index: true
  },
  coverageDetails: {
    type: String,
    default: 'Covers parts & labor against manufacturer defects.'
  },
  policyUrl: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'CLAIMED'],
    default: 'ACTIVE',
    index: true
  },
  claimsCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

warrantySchema.index({ userId: 1, endDate: 1 });
warrantySchema.index({ userId: 1, status: 1 });

module.exports = mongoose.models.Warranty || mongoose.model('Warranty', warrantySchema);
