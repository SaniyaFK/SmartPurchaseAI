const mongoose = require('mongoose');

const chatMessageSubSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  contextData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const chatHistorySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'Warranty & Spending Consultation'
  },
  messages: [chatMessageSubSchema],
  lastActive: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

chatHistorySchema.index({ userId: 1, lastActive: -1 });

module.exports = mongoose.models.ChatHistory || mongoose.model('ChatHistory', chatHistorySchema);
