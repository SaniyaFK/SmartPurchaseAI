const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  productName: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    index: true
  },
  brand: {
    type: String,
    default: '',
    trim: true
  },
  merchant: {
    type: String,
    required: [true, 'Merchant / Store name is required'],
    trim: true,
    index: true
  },
  storeName: {
    // Backward compatibility alias for merchant
    type: String,
    trim: true
  },
  category: {
    type: String,
    enum: ['Electronics', 'Home Appliances', 'Gadgets', 'Vehicles', 'Furniture', 'Fashion', 'Office', 'Sports', 'Sports & Fitness', 'Food & Groceries', 'Food & Beverages', 'Other'],
    default: 'Electronics',
    index: true
  },
  purchaseType: {
    type: String,
    enum: ['ONLINE', 'OFFLINE'],
    default: 'ONLINE',
    index: true
  },
  purchaseDate: {
    type: Date,
    required: [true, 'Purchase date is required'],
    default: Date.now,
    index: true
  },
  amount: {
    type: Number,
    required: [true, 'Purchase amount is required'],
    min: [0, 'Amount cannot be negative'],
    index: true
  },
  price: {
    // Backward compatibility alias for amount
    type: Number,
    min: [0, 'Price cannot be negative']
  },
  currency: {
    type: String,
    default: 'USD'
  },
  quantity: {
    type: Number,
    default: 1,
    min: [1, 'Quantity must be at least 1']
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentMethod: {
    type: String,
    default: 'Credit Card'
  },
  orderId: {
    type: String,
    default: '',
    trim: true
  },
  invoiceNumber: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  serialNumber: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  modelNumber: {
    type: String,
    default: '',
    trim: true
  },
  returnPeriodDays: {
    type: Number,
    default: 30,
    min: 0
  },
  returnDeadline: {
    type: Date,
    required: true,
    index: true
  },
  warrantyMonths: {
    type: Number,
    default: 12,
    min: 0
  },
  warrantyStart: {
    type: Date,
    default: Date.now
  },
  warrantyEnd: {
    type: Date,
    required: true,
    index: true
  },
  warrantyExpiresAt: {
    // Backward compatibility alias for warrantyEnd
    type: Date
  },
  warrantyType: {
    type: String,
    enum: ['Manufacturer', 'Extended', 'Store / Retailer', 'Lifetime', 'Credit Card Protected', 'None'],
    default: 'Manufacturer'
  },
  receiptReference: {
    type: String,
    default: ''
  },
  receiptImageUrl: {
    type: String,
    default: ''
  },
  receiptFileName: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'expiring_soon', 'expired', 'returned', 'claimed'],
    default: 'active',
    index: true
  },
  warrantyRemindersSent: [{
    sentAt: { type: Date, default: Date.now },
    daysUntilExpiry: { type: Number },
    reminderType: { type: String, enum: ['30day', '15day', '7day', 'manual'], default: 'manual' }
  }],
  claimHistory: [{
    claimDate: { type: Date, default: Date.now },
    issueDescription: { type: String, required: true },
    claimType: { type: String, default: 'Warranty Repair' },
    letterContent: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'in_review', 'approved', 'rejected', 'resolved'],
      default: 'draft'
    },
    resolution: { type: String, default: '' }
  }],
  isAnomaly: {
    type: Boolean,
    default: false
  },
  anomalyScore: {
    type: Number,
    default: 0
  },
  anomalyNotice: {
    type: String,
    default: ''
  },
  summary: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Pre-save hook to ensure aliases and dates are always synced.
// Note: Mongoose 9 removed the `next` callback from document middleware,
// so this hook is synchronous and simply mutates the document.
purchaseSchema.pre('save', function () {
  if (!this.merchant && this.storeName) this.merchant = this.storeName;
  if (!this.storeName && this.merchant) this.storeName = this.merchant;

  if (this.amount === undefined && this.price !== undefined) this.amount = this.price;
  if (this.price === undefined && this.amount !== undefined) this.price = this.amount;

  if (!this.warrantyStart && this.purchaseDate) this.warrantyStart = this.purchaseDate;
  if (!this.warrantyEnd && this.warrantyExpiresAt) this.warrantyEnd = this.warrantyExpiresAt;
  if (!this.warrantyExpiresAt && this.warrantyEnd) this.warrantyExpiresAt = this.warrantyEnd;
});

// Dynamic status calculation method
purchaseSchema.methods.calculateDynamicStatus = function () {
  const now = new Date();
  if (this.status === 'returned' || this.status === 'claimed') {
    return this.status;
  }
  
  const end = this.warrantyEnd || this.warrantyExpiresAt;
  if (end) {
    const expiry = new Date(end);
    const msDiff = expiry.getTime() - now.getTime();
    const daysLeft = Math.ceil(msDiff / (1000 * 60 * 60 * 24));
    
    if (daysLeft < 0) {
      return 'expired';
    } else if (daysLeft <= 30) {
      return 'expiring_soon';
    }
  }
  return 'active';
};

// Compound index for user searches and fast query filtering
purchaseSchema.index({ userId: 1, purchaseDate: -1 });
purchaseSchema.index({ userId: 1, category: 1 });
purchaseSchema.index({ userId: 1, status: 1 });
purchaseSchema.index({ userId: 1, returnDeadline: 1 });
purchaseSchema.index({ userId: 1, warrantyEnd: 1 });

module.exports = mongoose.models.Purchase || mongoose.model('Purchase', purchaseSchema);
