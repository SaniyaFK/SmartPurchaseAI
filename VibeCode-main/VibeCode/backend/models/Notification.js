const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['RETURN_DEADLINE_ALERT', 'WARRANTY_EXPIRY_ALERT', 'SPENDING_ALERT', 'CLAIM_UPDATE', 'SYSTEM'],
    default: 'SYSTEM',
    index: true
  },
  urgency: {
    type: String,
    enum: ['CRITICAL', 'WARNING', 'INFO'],
    default: 'INFO',
    index: true
  },
  purchaseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
    index: true
  },
  dueDate: {
    type: Date,
    index: true
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true
});

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
