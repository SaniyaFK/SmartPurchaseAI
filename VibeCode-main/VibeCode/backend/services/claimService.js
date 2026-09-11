const mongoose = require('mongoose');
const Claim = require('../models/Claim');
const PurchaseService = require('./purchaseService');
const NotificationService = require('./notificationService');
const AiClaimService = require('./aiClaimService');

// Resilient in-memory fallback store (mirrors NotificationService pattern)
const inMemoryClaims = new Map();
let memorySeq = 0;

function memId() {
  memorySeq += 1;
  return `claim_${Date.now()}_${memorySeq}_${Math.random().toString(36).substr(2, 5)}`;
}

function toSerializable(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = (obj._id && obj._id.toString) ? obj._id.toString() : obj._id;
  return obj;
}

function statusLabel(status) {
  const labels = {
    submitted: 'Submitted',
    in_review: 'In Review',
    approved: 'Approved',
    rejected: 'Rejected'
  };
  return labels[status] || status;
}

class ClaimService {
  /**
   * File a new AI warranty claim for a purchase.
   * Generates the claim letter, saves it to MongoDB, updates the purchase
   * status, and notifies the user.
   */
  static async createClaim(userId, {
    purchaseId,
    issueCategory,
    issueDescription,
    desiredResolution,
    customerName,
    customerEmail
  }) {
    const purchase = await PurchaseService.getPurchaseById(purchaseId, userId);
    if (!purchase) {
      throw Object.assign(new Error('Purchase item not found.'), { statusCode: 404 });
    }

    const letter = AiClaimService.generateClaimLetter({
      customerName: customerName || 'Authorized Purchaser',
      customerEmail: customerEmail || '',
      productName: purchase.productName,
      brand: purchase.brand,
      storeName: purchase.storeName || purchase.merchant,
      purchaseDate: purchase.purchaseDate,
      price: purchase.price !== undefined ? purchase.price : purchase.amount,
      currency: purchase.currency,
      warrantyMonths: purchase.warrantyMonths,
      warrantyExpiresAt: purchase.warrantyExpiresAt || purchase.warrantyEnd,
      serialNumber: purchase.serialNumber,
      modelNumber: purchase.modelNumber,
      invoiceNumber: purchase.invoiceNumber,
      issueCategory: issueCategory || 'Hardware Defect / Operational Failure',
      issueDescription: issueDescription || 'Device ceased operating under normal usage conditions.',
      desiredResolution: desiredResolution || 'Official Warranty Repair / Replacement'
    });

    const claimPayload = {
      userId,
      purchaseId: String(purchaseId),
      productName: purchase.productName,
      brand: purchase.brand || '',
      storeName: purchase.storeName || purchase.merchant || '',
      serialNumber: purchase.serialNumber || '',
      invoiceNumber: purchase.invoiceNumber || '',
      purchaseDate: purchase.purchaseDate || null,
      amount: purchase.amount !== undefined ? purchase.amount : (purchase.price || 0),
      currency: purchase.currency || 'PKR',
      issueCategory: issueCategory || 'Hardware Defect / Operational Failure',
      issueDescription: issueDescription || 'Device ceased operating under normal usage conditions.',
      desiredResolution: desiredResolution || 'Official Warranty Repair / Replacement',
      letterSubject: letter.subject,
      letterContent: letter.letterBody,
      status: 'submitted',
      submittedAt: new Date()
    };

    let savedClaim = null;

    if (mongoose.connection.readyState === 1) {
      try {
        const doc = new Claim(claimPayload);
        const saved = await doc.save();
        savedClaim = toSerializable(saved);
      } catch (err) {
        console.warn('Claim MongoDB save warning, using memory fallback:', err.message);
      }
    }

    if (!savedClaim) {
      const id = memId();
      savedClaim = {
        id,
        _id: id,
        ...claimPayload,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    inMemoryClaims.set(savedClaim.id, savedClaim);

    // Update the purchase: record claim history + status
    try {
      const currentClaims = purchase.claimHistory || [];
      currentClaims.push({
        issueDescription: claimPayload.issueDescription,
        claimType: claimPayload.desiredResolution,
        letterContent: letter.letterBody,
        status: 'submitted',
        claimedAt: new Date()
      });
      await PurchaseService.updatePurchase(purchaseId, userId, {
        claimHistory: currentClaims,
        status: 'claimed'
      });
    } catch (err) {
      console.warn('Could not update purchase claim history:', err.message);
    }

    // Notify the user about the claim submission
    await NotificationService.createNotification(userId, {
      title: 'Warranty Claim Submitted 🛡️',
      message: `Your AI-generated claim for ${purchase.productName} has been filed and recorded. Reference #${savedClaim.id.slice(-6).toUpperCase()} — keep the letter and follow up with ${purchase.storeName || purchase.merchant || 'the retailer'}.`,
      type: 'CLAIM_UPDATE',
      urgency: 'INFO',
      purchaseId: String(purchaseId),
      dueDate: purchase.warrantyExpiresAt || null
    });

    return savedClaim;
  }

  /**
   * List claims for a user (newest first)
   */
  static async listClaims(userId) {
    if (mongoose.connection.readyState === 1) {
      try {
        const docs = await Claim.find({ userId }).sort({ submittedAt: -1 });
        return docs.map(toSerializable);
      } catch (err) {
        console.warn('Claim query warning, using memory fallback:', err.message);
      }
    }

    return Array.from(inMemoryClaims.values())
      .filter(c => c.userId === userId)
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }

  /**
   * Get a single claim (ownership enforced)
   */
  static async getClaimById(userId, id) {
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await Claim.findOne({ _id: id, userId });
        if (doc) return toSerializable(doc);
      } catch (err) {}
    }
    const record = inMemoryClaims.get(id);
    if (record && record.userId === userId) return record;
    return null;
  }

  /**
   * Update claim status (submitted → in_review → approved/rejected).
   * Notifies the user whenever the status changes.
   */
  static async updateClaimStatus(userId, id, status, resolutionNote = '') {
    const validStatuses = ['submitted', 'in_review', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw Object.assign(new Error(`Invalid status. Allowed: ${validStatuses.join(', ')}`), { statusCode: 400 });
    }

    const claim = await ClaimService.getClaimById(userId, id);
    if (!claim) return null;

    const previousStatus = claim.status;
    const updateData = {
      status,
      resolutionNote: resolutionNote || claim.resolutionNote || '',
      resolvedAt: (status === 'approved' || status === 'rejected') ? new Date() : null
    };

    let updated = null;
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await Claim.findOneAndUpdate(
          { _id: id, userId },
          { $set: updateData },
          { returnDocument: 'after' }
        );
        if (doc) updated = toSerializable(doc);
      } catch (err) {}
    }
    if (!updated) {
      const record = inMemoryClaims.get(id);
      if (record && record.userId === userId) {
        Object.assign(record, updateData, { updatedAt: new Date() });
        inMemoryClaims.set(id, record);
        updated = record;
      }
    }

    // Notify only on actual status change
    if (updated && previousStatus !== status) {
      const statusEmoji = status === 'approved' ? '✅' : status === 'rejected' ? '❌' : status === 'in_review' ? '🔍' : '🛡️';
      const titleMap = {
        in_review: 'Claim Under Review 🔍',
        approved: 'Claim Approved ✅',
        rejected: 'Claim Update ❌'
      };
      await NotificationService.createNotification(userId, {
        title: titleMap[status] || 'Claim Status Update',
        message: `Your claim for ${updated.productName} (Ref #${updated.id.slice(-6).toUpperCase()}) is now **${statusLabel(status)}**.${resolutionNote ? ` ${resolutionNote}` : ''}`,
        type: 'CLAIM_UPDATE',
        urgency: status === 'approved' ? 'INFO' : status === 'rejected' ? 'WARNING' : 'INFO',
        purchaseId: updated.purchaseId || null,
        dueDate: null
      });
    }

    return updated;
  }

  /**
   * Delete a claim (ownership enforced)
   */
  static async deleteClaim(userId, id) {
    let deleted = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const res = await Claim.deleteOne({ _id: id, userId });
        deleted = res.deletedCount > 0;
      } catch (err) {}
    }
    const record = inMemoryClaims.get(id);
    if (record && record.userId === userId) {
      inMemoryClaims.delete(id);
      deleted = true;
    }
    return deleted;
  }
}

module.exports = ClaimService;
