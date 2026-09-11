const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const PurchaseService = require('./purchaseService');
const ClaimService = require('./claimService');

// Resilient in-memory fallback store (mirrors other services)
const inMemoryChats = new Map();
let memorySeq = 0;

function memId(prefix) {
  memorySeq += 1;
  return `${prefix}_${Date.now()}_${memorySeq}_${Math.random().toString(36).substr(2, 5)}`;
}

function toSerializable(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = (obj._id && obj._id.toString) ? obj._id.toString() : obj._id;
  return obj;
}

function fmtMoney(value, currency) {
  const symbols = { USD: '$', EUR: '€', GBP: '£', INR: '₹', PKR: '₨' };
  const symbol = symbols[currency] || symbols.PKR;
  return `${symbol}${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return 'N/A';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

class CopilotService {
  /**
   * Load the user's full data context (purchases, analytics, deadlines, claims)
   */
  static async buildContext(userId) {
    const [purchases, analytics, deadlines, claims] = await Promise.all([
      PurchaseService.getPurchases(userId).catch(() => []),
      PurchaseService.getSpendingAnalytics(userId).catch(() => null),
      PurchaseService.getDeadlinesAndAlerts(userId).catch(() => ({ returnAlerts: [], warrantyAlerts: [] })),
      ClaimService.listClaims(userId).catch(() => [])
    ]);
    return { purchases, analytics, deadlines, claims };
  }

  /**
   * Rule-based intent router — answers from the user's real data.
   * Returns plain-text-ish markdown suitable for the chat bubble.
   */
  /**
   * Generate prioritized, data-driven suggestions from the user's vault.
   * Returns an array of { type, priority, icon, title, text, purchaseId }.
   */
  static generateSuggestions(ctx) {
    const { purchases, analytics, deadlines, claims } = ctx;
    const suggestions = [];

    // 1. Urgent return windows closing soon
    (deadlines.returnAlerts || [])
      .filter(a => a.daysLeft >= 0 && a.daysLeft <= 7)
      .forEach(a => {
        suggestions.push({
          type: 'RETURN',
          priority: a.daysLeft <= 3 ? 'CRITICAL' : 'HIGH',
          icon: 'fa-arrow-rotate-left',
          title: `Return ${a.productName}`,
          text: `Return window closes in ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} (${a.deadlineDate}) — ${fmtMoney(a.amount, a.currency)} at stake.`,          purchaseId: a.purchaseId
        });
      });

    // 2. Warranties expiring within 30 days
    (deadlines.warrantyAlerts || [])
      .filter(a => a.daysLeft >= 0 && a.daysLeft <= 30)
      .forEach(a => {
        suggestions.push({
          type: 'WARRANTY',
          priority: a.daysLeft <= 10 ? 'CRITICAL' : 'HIGH',
          icon: 'fa-shield-halved',
          title: `Inspect ${a.productName} before warranty ends`,
          text: `Coverage expires in ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} (${a.expiryDate}). Check for defects now to use free repair.`,          purchaseId: a.purchaseId
        });
      });

    // 3. Open claims that may need follow-up
    claims
      .filter(c => c.status === 'submitted' || c.status === 'in_review')
      .forEach(c => {
        suggestions.push({
          type: 'CLAIM',
          priority: 'MEDIUM',
          icon: 'fa-file-signature',
          title: `Follow up on claim for ${c.productName}`,
          text: `Status: ${c.status.replace(/_/g, ' ')}. Contact ${c.storeName || 'the retailer'} if you haven't heard back.`,          purchaseId: c.purchaseId
        });
      });

    // 4. Missing serial numbers (claim-readiness gap)
    purchases
      .filter(p => !p.serialNumber && p.daysUntilWarrantyExpiry > 0)
      .slice(0, 2)
      .forEach(p => {
        suggestions.push({
          type: 'DATA_GAP',
          priority: 'LOW',
          icon: 'fa-hashtag',
          title: `Add serial number for ${p.productName}`,
          text: 'Serial numbers make AI warranty claims faster and more credible.',
          purchaseId: p.id
        });
      });

    // 5. Missing receipt images
    purchases
      .filter(p => !p.receiptImageUrl && p.daysUntilWarrantyExpiry > 0)
      .slice(0, 2)
      .forEach(p => {
        suggestions.push({
          type: 'DATA_GAP',
          priority: 'LOW',
          icon: 'fa-folder-open',
          title: `Upload the receipt for ${p.productName}`,
          text: 'Digitized receipts are required to file a warranty claim.',
          purchaseId: p.id
        });
      });

    // 6. Money at risk insight
    const atRisk = analytics?.metrics?.moneyAtRisk?.value || 0;
    const atRiskCount = analytics?.metrics?.moneyAtRisk?.count || 0;
    if (atRisk > 0) {
      suggestions.push({
        type: 'SPEND',
        priority: 'MEDIUM',
        icon: 'fa-triangle-exclamation',
        title: `${fmtMoney(atRisk)} is at risk`,
        text: `${atRiskCount} item${atRiskCount === 1 ? '' : 's'} with deadlines closing in the next 30 days. Act now.`
      });
    }

    // 7. Top spending category
    const labels = analytics?.charts?.categoryAllocation?.labels || [];
    const values = analytics?.charts?.categoryAllocation?.values || [];
    if (labels.length > 0 && values.length > 0) {
      let topIdx = 0;
      values.forEach((v, i) => { if (v > values[topIdx]) topIdx = i; });
      suggestions.push({
        type: 'SPEND',
        priority: 'LOW',
        icon: 'fa-chart-pie',
        title: `Your biggest spend: ${labels[topIdx]}`,
        text: `${fmtMoney(values[topIdx])} of your total tracked spend is in ${labels[topIdx]}. Keep receipts digitized.`
      });
    }

    // Sort by priority, keep top 6
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    suggestions.sort((a, b) => (rank[a.priority] !== undefined ? rank[a.priority] : 3) - (rank[b.priority] !== undefined ? rank[b.priority] : 3));

    if (suggestions.length === 0) {
      suggestions.push({
        type: 'HEALTHY',
        priority: 'LOW',
        icon: 'fa-circle-check',
        title: 'Everything looks healthy',
        text: 'No urgent returns or expiring warranties. Add more purchases to get smarter suggestions.'
      });
    }

    return suggestions.slice(0, 6);
  }

  /**
   * Quick numeric summary of the user's vault (for the chat welcome).
   */
  static getSummary(ctx) {
    const { purchases, analytics, deadlines, claims } = ctx;
    const m = analytics?.metrics;
    return {
      itemCount: purchases.length,
      totalSpend: m?.totalSpend?.value || 0,
      activeWarranties: m?.activeWarrantyCount || 0,
      urgentReturns: (deadlines.returnAlerts || []).filter(a => a.daysLeft >= 0 && a.daysLeft <= 7).length,
      expiringWarranties: (deadlines.warrantyAlerts || []).filter(a => a.daysLeft >= 0 && a.daysLeft <= 30).length,
      claimsOpen: claims.filter(c => c.status === 'submitted' || c.status === 'in_review').length,
      moneyAtRisk: m?.moneyAtRisk?.value || 0
    };
  }

  /**
   * Rule-based intent router — answers from the user's real data.
   * Returns plain-text-ish markdown suitable for the chat bubble.
   */
  static composeAnswer(ctx, query) {
    const q = query.toLowerCase();
    const { purchases, analytics, deadlines, claims } = ctx;

    // ---- Suggestions / recommendations (data-driven) ----
    if (q.includes('suggest') || q.includes('recommend') || q.includes('advice') || q.includes('what should') || q.includes('what can i do') || q.includes('action') || q.includes('improve') || q.includes('optimize') || q.includes('tip') || q.includes('help me')) {
      const sugg = CopilotService.generateSuggestions(ctx);
      const lines = sugg.map((s, i) => `${i + 1}. <strong>${s.title}</strong> — ${s.text}`).join('\n');
      return `💡 <strong>Here are your top ${sugg.length} data-driven suggestions:</strong>\n${lines}`;
    }

    // ---- Returns / deadlines ----
    if (q.includes('return') || q.includes('deadline') || q.includes('refund')) {
      const alerts = (deadlines.returnAlerts || []).filter(a => a.daysLeft >= 0);
      if (alerts.length === 0) {
        return '✅ **Great news!** You have no return windows closing in the next 14 days. All your purchase return deadlines are safe for now.';
      }
      const lines = alerts.map(a =>
        `• <strong>${a.productName}</strong> — ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left (closes ${a.deadlineDate}) · ${fmtMoney(a.amount, a.currency)}`
      ).join('\n');
      return `⏳ <strong>Return windows closing soon:</strong>\n${lines}\n\n💡 <em>Act before the deadline to secure a full refund — once it passes, refunds typically drop to store credit or stop entirely.</em>`;
    }

    // ---- Warranties ----
    if (q.includes('warranty') || q.includes('expire') || q.includes('coverage') || q.includes('protect')) {
      const alerts = (deadlines.warrantyAlerts || []).filter(a => a.daysLeft >= 0);
      if (alerts.length === 0) {
        const active = purchases.filter(p => (p.daysUntilWarrantyExpiry !== undefined ? p.daysUntilWarrantyExpiry : 0) > 0);
        if (active.length > 0) {
          return `🛡️ <strong>All ${active.length} active item${active.length === 1 ? '' : 's'} have healthy warranty coverage.</strong> No warranties expire within the next 60 days.`;
        }
        return '🛡️ You have no items with active manufacturer warranty coverage right now.';
      }
      const lines = alerts.map(a =>
        `• <strong>${a.productName}</strong>${a.brand ? ` (${a.brand})` : ''} — ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left (expires ${a.expiryDate})`
      ).join('\n');
      return `🛡️ <strong>Warranties expiring soon:</strong>\n${lines}\n\n💡 <em>Inspect these items now for defects so you can use the free manufacturer repair before coverage ends.</em>`;
    }

    // ---- Spending / money ----
    if (q.includes('spend') || q.includes('total') || q.includes('cost') || q.includes('money') || q.includes('budget') || q.includes('price')) {
      if (analytics && analytics.metrics) {
        const m = analytics.metrics;
        return `💰 <strong>Your Spending Summary:</strong>\n• Total tracked spend: <strong>${fmtMoney(m.totalSpend.value)}</strong> across ${m.totalItemsCount} purchase${m.totalItemsCount === 1 ? '' : 's'}\n• This month: <strong>${fmtMoney(m.thisMonthSpend.value)}</strong> (${m.thisMonthSpend.subText})\n• Protected warranty value: <strong>${fmtMoney(m.activeWarrantiesValue.value)}</strong> (${m.activeWarrantyCount} item${m.activeWarrantyCount === 1 ? '' : 's'})\n• Projected next month: <strong>${fmtMoney(m.spendingPrediction.value)}</strong>\n\n💡 <em>Tip: your biggest categories and retailers are visible in Expense Analytics on the dashboard.</em>`;
      }
      return '💰 You have no spending data yet. Scan a receipt or add a purchase to start tracking.';
    }

    // ---- Claims ----
    if (q.includes('claim') || q.includes('dispute') || q.includes('repair') || q.includes('broken') || q.includes('defect')) {
      if (claims.length > 0) {
        const lines = claims.map(c =>
          `• <strong>${c.productName}</strong> — ${c.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}${c.resolutionNote ? ` (${c.resolutionNote})` : ''}`
        ).join('\n');
        return `✍️ <strong>Your warranty claims (${claims.length}):</strong>\n${lines}\n\nTo file a new one, open <strong>Claims</strong> from the sidebar or use the wand icon on any purchase in the vault.`;
      }
      return `✍️ <strong>File a 1-Click AI Warranty Claim:</strong>\n1. Open <strong>Purchases & Vault</strong>.\n2. Click the ✨ wand icon on any item (or open its detail view).\n3. Describe the defect — the AI generates a formal, legally structured dispute letter citing your invoice, serial number, and warranty terms, saved to your Claims page.`;
    }

    // ---- Store policies ----
    if (q.includes('apple') || q.includes('best buy') || q.includes('amazon') || q.includes('samsung') || q.includes('nike') || q.includes('policy') || q.includes('store')) {
      return `🏪 <strong>Store Policy Knowledge:</strong>\n• <strong>Apple Store:</strong> 14-day return window & 1-year limited warranty.\n• <strong>Best Buy:</strong> 15-day return (60 days for Total members).\n• <strong>Amazon:</strong> 30-day returns & A-to-z Guarantee.\n• <strong>Samsung:</strong> 2-year warranty (10-yr digital inverter/compressor).\n• <strong>Nike:</strong> 60-day wear-test return trial.\n\nI can also look at <em>your</em> purchases from these stores — try "What did I buy from Apple?"`;
    }

    // ---- Specific product / store ----
    const productMatch = purchases.find(p =>
      p.productName && q.includes(p.productName.toLowerCase().split(' ')[0])
    );
    if (productMatch) {
      const daysW = productMatch.daysUntilWarrantyExpiry;
      const daysR = productMatch.daysUntilReturnDeadline;
      return `📦 <strong>${productMatch.productName}</strong> (${productMatch.brand || 'Unknown brand'}):\n• Bought: ${fmtDate(productMatch.purchaseDate)} from ${productMatch.storeName || productMatch.merchant} for ${fmtMoney(productMatch.amount, productMatch.currency)}\n• Warranty: ${daysW > 0 ? `<strong>${daysW} days left</strong> (until ${fmtDate(productMatch.warrantyEnd)})` : 'expired'}\n• Return window: ${daysR > 0 ? `<strong>${daysR} days left</strong> (until ${fmtDate(productMatch.returnDeadline)})` : 'closed'}\n• Serial: ${productMatch.serialNumber || 'N/A'} · Invoice: ${productMatch.invoiceNumber || 'N/A'}`;
    }

    // ---- Most expensive ----
    if (q.includes('expensive') || q.includes('most') || q.includes('largest') || q.includes('biggest')) {
      if (purchases.length === 0) {
        return 'You have no tracked purchases yet. Add one to see insights like this.';
      }
      const sorted = [...purchases].sort((a, b) => (b.amount || 0) - (a.amount || 0));
      const top = sorted.slice(0, 3);
      const lines = top.map((p, i) => `• <strong>${p.productName}</strong> — ${fmtMoney(p.amount, p.currency)} (${fmtDate(p.purchaseDate)})`).join('\n');
      return `🏆 <strong>Your most valuable purchases:</strong>\n${lines}`;
    }

    // ---- Upcoming ----
    if (q.includes('upcoming') || q.includes('soon') || q.includes('next')) {
      const parts = [];
      const ret = (deadlines.returnAlerts || []).filter(a => a.daysLeft >= 0).slice(0, 3);
      const war = (deadlines.warrantyAlerts || []).filter(a => a.daysLeft >= 0).slice(0, 3);
      if (ret.length) parts.push(`⏳ Returns: ${ret.map(a => `${a.productName} (${a.daysLeft}d)`).join(', ')}`);
      if (war.length) parts.push(`🛡️ Warranties: ${war.map(a => `${a.productName} (${a.daysLeft}d)`).join(', ')}`);
      if (parts.length === 0) return '📅 Nothing urgent coming up — all your deadlines and warranties are comfortably ahead.';
      return `📅 <strong>Upcoming deadlines:</strong>\n${parts.join('\n')}`;
    }

    // ---- Stats overview ----
    if (q.includes('overview') || q.includes('summary') || q.includes('hello') || q.includes('hi ') || q === 'hi' || q === 'hey' || q.includes('what can you')) {
      const m = analytics ? analytics.metrics : null;
      return `👋 <strong>Here's your warranty vault at a glance:</strong>\n• ${purchases.length} tracked purchase${purchases.length === 1 ? '' : 's'} · ${m ? fmtMoney(m.totalSpend.value) : '$0.00'} total\n• ${m ? m.activeWarrantyCount : 0} active warranty${m && m.activeWarrantyCount === 1 ? '' : 's'} · ${(deadlines.returnAlerts || []).length} return deadline${(deadlines.returnAlerts || []).length === 1 ? '' : 's'} closing soon\n• ${claims.length} claim${claims.length === 1 ? '' : 's'} on file\n\nTry asking: <em>"What return deadlines are ending soon?"</em>, <em>"Which warranties expire next?"</em>, or <em>"How much did I spend?"</em>`;
    }

    // ---- Fallback ----
    return `I can help you with your real purchase data:\n1. <strong>Track Returns</strong> — items expiring soon.\n2. <strong>Warranty Alerts</strong> — coverage periods.\n3. <strong>Spending Insights</strong> — totals, this month, projections.\n4. <strong>1-Click AI Claims</strong> — draft formal dispute letters.\n\nTry asking: <em>"What return deadlines are ending soon?"</em>`;
  }

  /**
   * Answer a question and persist the exchange in ChatHistory.
   * Returns { answer, sessionId, suggestions }.
   */
  static async chat(userId, message, sessionId = null) {
    const ctx = await CopilotService.buildContext(userId);
    const answer = CopilotService.composeAnswer(ctx, message);
    const suggestions = CopilotService.generateSuggestions(ctx);

    // Persist to ChatHistory (MongoDB with memory fallback)
    let currentSession = sessionId;

    if (mongoose.connection.readyState === 1) {
      try {
        let session = currentSession
          ? await ChatHistory.findOne({ sessionId: currentSession, userId })
          : null;
        if (!session) {
          session = new ChatHistory({
            userId,
            sessionId: currentSession || memId('chat'),
            title: `Consultation ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            messages: []
          });
          currentSession = session.sessionId;
        }

        session.messages.push(
          { role: 'user', content: message, timestamp: new Date() },
          { role: 'assistant', content: answer, timestamp: new Date() }
        );
        if (session.messages.length > 100) {
          session.messages = session.messages.slice(-100);
        }
        session.lastActive = new Date();
        await session.save();
      } catch (err) {
        console.warn('ChatHistory save warning, using memory fallback:', err.message);
      }
    }

    if (!currentSession) currentSession = sessionId || memId('chat');
    const key = currentSession;
    const existing = inMemoryChats.get(key);
    if (existing) {
      existing.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: answer, timestamp: new Date() }
      );
      existing.lastActive = new Date();
      inMemoryChats.set(key, existing);
    } else {
      inMemoryChats.set(key, {
        id: key,
        sessionId: key,
        userId,
        title: `Consultation ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        messages: [
          { role: 'user', content: message, timestamp: new Date() },
          { role: 'assistant', content: answer, timestamp: new Date() }
        ],
        lastActive: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    return { answer, sessionId: currentSession, suggestions };
  }

  /**
   * Get data-driven suggestions + a quick vault summary (no history write).
   * Used by the chatbot welcome / suggestion chips.
   */
  static async getSuggestions(userId) {
    const ctx = await CopilotService.buildContext(userId);
    return {
      suggestions: CopilotService.generateSuggestions(ctx),
      summary: CopilotService.getSummary(ctx)
    };
  }

  /**
   * List chat sessions for a user (most recent first)
   */
  static async getSessions(userId) {
    if (mongoose.connection.readyState === 1) {
      try {
        const docs = await ChatHistory.find({ userId }).sort({ lastActive: -1 });
        return docs.map(d => {
          const obj = toSerializable(d);
          obj.messageCount = (obj.messages || []).length;
          return obj;
        });
      } catch (err) {
        console.warn('ChatHistory query warning, using memory fallback:', err.message);
      }
    }
    return Array.from(inMemoryChats.values())
      .filter(c => c.userId === userId)
      .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
      .map(c => ({ ...c, messageCount: (c.messages || []).length }));
  }

  /**
   * Get messages for a session (ownership enforced)
   */
  static async getSessionMessages(userId, sessionId) {
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await ChatHistory.findOne({ sessionId, userId });
        if (doc) return toSerializable(doc);
      } catch (err) {}
    }
    const record = inMemoryChats.get(sessionId);
    if (record && record.userId === userId) return record;
    return null;
  }

  /**
   * Clear a session (ownership enforced)
   */
  static async clearSession(userId, sessionId) {
    let deleted = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const res = await ChatHistory.deleteOne({ sessionId, userId });
        deleted = res.deletedCount > 0;
      } catch (err) {}
    }
    const record = inMemoryChats.get(sessionId);
    if (record && record.userId === userId) {
      inMemoryChats.delete(sessionId);
      deleted = true;
    }
    return deleted;
  }
}

module.exports = CopilotService;
