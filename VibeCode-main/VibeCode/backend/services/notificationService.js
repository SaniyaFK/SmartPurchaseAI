const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const PurchaseService = require('./purchaseService');

// Resilient in-memory fallback store (mirrors PurchaseService pattern)
const inMemoryNotifications = new Map();
let memorySeq = 0;

function memId() {
  memorySeq += 1;
  return `notif_${Date.now()}_${memorySeq}_${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * The Notification schema stores purchaseId as an ObjectId. In-memory
 * purchases use string IDs (pur_...), so only pass through valid ObjectIds
 * and fall back to null for memory-backed records.
 */
function toObjectIdOrNull(id) {
  if (!id) return null;
  const str = String(id);
  if (mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str) {
    return new mongoose.Types.ObjectId(str);
  }
  return null;
}

function toSerializable(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = (obj._id && obj._id.toString) ? obj._id.toString() : obj._id;
  return obj;
}

function urgencyForReturn(daysLeft) {
  if (daysLeft <= 3) return 'CRITICAL';
  if (daysLeft <= 7) return 'WARNING';
  return 'INFO';
}

function urgencyForWarranty(daysLeft) {
  if (daysLeft <= 10) return 'CRITICAL';
  if (daysLeft <= 30) return 'WARNING';
  return 'INFO';
}

class NotificationService {
  /**
   * Create a single notification for a user (deduplicated by type+purchaseId)
   */
  static async createNotification(userId, { title, message, type = 'SYSTEM', urgency = 'INFO', purchaseId = null, dueDate = null }) {
    const normalizedPurchaseId = toObjectIdOrNull(purchaseId);
    const payload = { userId, title, message, type, urgency, purchaseId: normalizedPurchaseId, dueDate, isRead: false };

    // MongoDB path
    if (mongoose.connection.readyState === 1) {
      try {
        const query = { userId, type };
        if (normalizedPurchaseId) query.purchaseId = normalizedPurchaseId;
        const existing = await Notification.findOne(query);
        if (existing) {
          // Refresh existing alert (keeps seed idempotent but current)
          existing.title = title;
          existing.message = message;
          existing.urgency = urgency;
          existing.dueDate = dueDate || existing.dueDate;
          await existing.save();
          return toSerializable(existing);
        }
        const doc = new Notification(payload);
        const saved = await doc.save();
        const serialized = toSerializable(saved);
        inMemoryNotifications.set(serialized.id, serialized);
        return serialized;
      } catch (err) {
        console.warn('Notification MongoDB save warning, using memory fallback:', err.message);
      }
    }

    // In-memory fallback
    const key = purchaseId ? `${type}:${purchaseId}` : `${type}:welcome`;
    for (const notif of inMemoryNotifications.values()) {
      if (notif.userId === userId && notif.type === type && (notif.purchaseId || '').toString() === (purchaseId || '').toString()) {
        notif.title = title;
        notif.message = message;
        notif.urgency = urgency;
        notif.dueDate = dueDate || notif.dueDate;
        inMemoryNotifications.set(notif.id, notif);
        return notif;
      }
    }

    const id = memId();
    const record = { id, _id: id, ...payload, createdAt: new Date(), updatedAt: new Date() };
    inMemoryNotifications.set(id, record);
    return record;
  }

  /**
   * Seed notifications for a user from their purchases (deadlines & warranty alerts) + welcome
   */
  static async seedFromPurchases(userId) {
    const created = [];
    const hasAny = await NotificationService.getUnreadCount(userId).then(c => c > 0).catch(() => false);

    // Welcome / system notification on first visit
    if (!hasAny) {
      const welcome = await NotificationService.createNotification(userId, {
        title: 'Welcome to WarrantyVault AI 👋',
        message: 'Your smart purchase & warranty command center is ready. Scan receipts, track return windows, and let AI protect your purchases.',
        type: 'SYSTEM',
        urgency: 'INFO'
      });
      created.push(welcome);
    }

    const deadlines = await PurchaseService.getDeadlinesAndAlerts(userId);

    for (const alert of deadlines.returnAlerts || []) {
      const createdNotif = await NotificationService.createNotification(userId, {
        title: alert.daysLeft <= 3 ? 'Return Window Closing NOW!' : 'Return Window Ending Soon',
        message: `${alert.productName} — return window closes in ${alert.daysLeft} day${alert.daysLeft === 1 ? '' : 's'} at ${alert.storeName}. Act now to secure a full refund of ₨${(alert.amount || alert.price || 0).toLocaleString()}.`,
        type: 'RETURN_DEADLINE_ALERT',
        urgency: urgencyForReturn(alert.daysLeft),
        purchaseId: alert.purchaseId,
        dueDate: new Date(new Date().getTime() + alert.daysLeft * 86400000)
      });
      created.push(createdNotif);
    }

    for (const alert of deadlines.warrantyAlerts || []) {
      const createdNotif = await NotificationService.createNotification(userId, {
        title: alert.daysLeft <= 10 ? 'Warranty Expiring Imminently!' : 'Warranty Expiring Soon',
        message: `${alert.productName}${alert.brand ? ` (${alert.brand})` : ''} — warranty coverage ends in ${alert.daysLeft} day${alert.daysLeft === 1 ? '' : 's'} (${alert.expiryDate}). Inspect the item before free repair expires.`,
        type: 'WARRANTY_EXPIRY_ALERT',
        urgency: urgencyForWarranty(alert.daysLeft),
        purchaseId: alert.purchaseId,
        dueDate: new Date(new Date().getTime() + alert.daysLeft * 86400000)
      });
      created.push(createdNotif);
    }

    return created;
  }

  /**
   * List notifications for a user (unread first, newest first)
   */
  static async listNotifications(userId) {
    if (mongoose.connection.readyState === 1) {
      try {
        const docs = await Notification.find({ userId }).sort({ isRead: 1, createdAt: -1 });
        return docs.map(toSerializable);
      } catch (err) {
        console.warn('Notification query warning, using memory fallback:', err.message);
      }
    }

    return Array.from(inMemoryNotifications.values())
      .filter(n => n.userId === userId)
      .sort((a, b) => {
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
  }

  /**
   * Count unread notifications
   */
  static async getUnreadCount(userId) {
    if (mongoose.connection.readyState === 1) {
      try {
        return await Notification.countDocuments({ userId, isRead: false });
      } catch (err) {}
    }
    return Array.from(inMemoryNotifications.values()).filter(n => n.userId === userId && !n.isRead).length;
  }

  /**
   * Mark a single notification as read (ownership enforced)
   */
  static async markAsRead(userId, id) {
    if (mongoose.connection.readyState === 1) {
      try {
        const updated = await Notification.findOneAndUpdate(
          { _id: id, userId },
          { $set: { isRead: true } },
          { returnDocument: 'after' }
        );
        if (updated) {
          const serialized = toSerializable(updated);
          inMemoryNotifications.set(serialized.id, serialized);
          return serialized;
        }
      } catch (err) {}
    }

    const record = inMemoryNotifications.get(id);
    if (record && record.userId === userId) {
      record.isRead = true;
      record.updatedAt = new Date();
      inMemoryNotifications.set(id, record);
      return record;
    }
    return null;
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId) {
    if (mongoose.connection.readyState === 1) {
      try {
        const res = await Notification.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
        for (const [id, record] of inMemoryNotifications.entries()) {
          if (record.userId === userId) {
            record.isRead = true;
            inMemoryNotifications.set(id, record);
          }
        }
        return res.modifiedCount;
      } catch (err) {}
    }

    let count = 0;
    for (const [id, record] of inMemoryNotifications.entries()) {
      if (record.userId === userId && !record.isRead) {
        record.isRead = true;
        inMemoryNotifications.set(id, record);
        count++;
      }
    }
    return count;
  }
}

module.exports = NotificationService;
