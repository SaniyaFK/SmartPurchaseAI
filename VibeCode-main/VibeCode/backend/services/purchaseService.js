const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Receipt = require('../models/Receipt');
const AiReceiptParser = require('./aiReceiptParser');
const EmailService = require('./emailService');
const MlService = require('./mlService');
const ReceiptSummaryService = require('./receiptSummaryService');
// RAG sync — lazy require to avoid any circular-dependency issues at startup
let RagIndexService;
function getRagIndex() {
  if (!RagIndexService) {
    try { RagIndexService = require('./ragIndexService'); } catch (e) { /* RAG not yet available */ }
  }
  return RagIndexService;
}

// Resilient in-memory fallback store
const inMemoryPurchases = new Map();

// Helper to seed initial purchases for a user
function seedInitialUserPurchases(userId) {
  const samples = AiReceiptParser.getSampleReceipts();
  const seeded = [];

  for (const sample of samples) {
    const purchaseDate = new Date(sample.data.purchaseDate);
    const warrantyMonths = sample.data.warrantyMonths || 12;
    const returnPeriodDays = sample.data.returnPeriodDays || 30;

    const warrantyEnd = new Date(purchaseDate);
    warrantyEnd.setMonth(warrantyEnd.getMonth() + warrantyMonths);

    const returnDeadline = new Date(purchaseDate);
    returnDeadline.setDate(returnDeadline.getDate() + returnPeriodDays);

    const id = `pur_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date();
    const daysToExpiry = Math.ceil((warrantyEnd - now) / (1000 * 60 * 60 * 24));
    
    let status = 'active';
    if (daysToExpiry < 0) status = 'expired';
    else if (daysToExpiry <= 30) status = 'expiring_soon';

    const item = {
      _id: id,
      id: id,
      userId,
      ...sample.data,
      merchant: sample.data.storeName || sample.data.merchant || 'Retailer',
      storeName: sample.data.storeName || sample.data.merchant || 'Retailer',
      amount: sample.data.price || sample.data.amount || 0,
      price: sample.data.price || sample.data.amount || 0,
      quantity: 1,
      tax: 0,
      discount: 0,
      purchaseType: 'ONLINE',
      purchaseDate,
      warrantyStart: purchaseDate,
      warrantyEnd,
      warrantyExpiresAt: warrantyEnd,
      returnDeadline,
      status,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    inMemoryPurchases.set(id, item);
    seeded.push(item);
  }
  return seeded;
}

class PurchaseService {
  /**
   * Helper function to escape special regex characters.
   */
  static _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Keyword heuristic category inference (fallback when ML microservice is offline).
   */
  static inferCategoryFromKeywords(productName = '', merchant = '', notes = '') {
    const text = `${productName} ${merchant} ${notes}`.toLowerCase();

    if (/iphone|macbook|laptop|phone|tv|headphone|camera|monitor|tablet|keyboard|mouse|speaker|dell|samsung|apple|sony/i.test(text)) {
      return 'Electronics';
    }
    if (/fridge|refrigerator|washing machine|microwave|air conditioner|ac|vacuum|oven|toaster|dishwasher/i.test(text)) {
      return 'Home Appliances';
    }
    if (/smartwatch|fitness band|drone|vr|action cam|playstation|xbox|nintendo/i.test(text)) {
      return 'Gadgets';
    }
    if (/car|bike|motorcycle|scooter|tire|helmet|vehicle|automotive/i.test(text)) {
      return 'Vehicles';
    }
    if (/sofa|chair|table|desk|bed|mattress|wardrobe|cabinet|furniture/i.test(text)) {
      return 'Furniture';
    }
    if (/shirt|pants|jacket|shoes|dress|bag|wallet|watch|zara|nike|adidas|fashion|clothing/i.test(text)) {
      return 'Fashion';
    }
    if (/printer|paper|shredder|stapler|office|desk organizer|ink|toner/i.test(text)) {
      return 'Office';
    }
    if (/treadmill|dumbbells|yoga|bicycle|gym|sports|fitness|racket/i.test(text)) {
      return 'Sports & Fitness';
    }
    if (/grocery|food|supermarket|walmart|milk|bread|coffee|beverage|snack/i.test(text)) {
      return 'Food & Groceries';
    }
    return 'Electronics';
  }

  /**
   * Check if a purchase is a duplicate of an existing record for the given user.
   * Duplicate criteria:
   * 1. Exact non-empty match on invoiceNumber, orderId, or serialNumber
   * 2. Matching receiptFileName / file reference
   * 3. Matching productName AND merchant/storeName AND amount/price (with or without date)
   * 4. Matching productName AND amount/price
   */
  static async checkDuplicate(userId, data) {
    if (!userId || !data) return null;

    const invoiceNum = (data.invoiceNumber || '').trim();
    const orderId = (data.orderId || '').trim();
    const serialNum = (data.serialNumber || '').trim();
    const fileName = (data.receiptFileName || data.filename || '').trim();

    const prodName = (data.productName || data.product || '').trim();
    const merchant = (data.merchant || data.storeName || '').trim();
    const rawAmt = data.amount !== undefined ? data.amount : data.price;
    const amount = rawAmt !== undefined && rawAmt !== null && !isNaN(parseFloat(rawAmt)) ? parseFloat(rawAmt) : null;

    let dateStr = null;
    if (data.purchaseDate) {
      const d = new Date(data.purchaseDate);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().split('T')[0];
      }
    }

    // 1. Check in MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        const orConditions = [];

        if (invoiceNum) {
          orConditions.push({ userId, invoiceNumber: invoiceNum });
        }
        if (orderId) {
          orConditions.push({ userId, orderId: orderId });
        }
        if (serialNum) {
          orConditions.push({ userId, serialNumber: serialNum });
        }
        if (fileName && fileName.length > 5 && !fileName.startsWith('receipt_scan')) {
          orConditions.push({ userId, receiptFileName: fileName });
        }

        // Product + Merchant + Amount match (case-insensitive)
        if (prodName && merchant && amount !== null) {
          const cond = {
            userId,
            amount: { $gte: amount - 0.05, $lte: amount + 0.05 },
            productName: { $regex: new RegExp('^' + PurchaseService._escapeRegExp(prodName) + '$', 'i') },
            merchant: { $regex: new RegExp('^' + PurchaseService._escapeRegExp(merchant) + '$', 'i') }
          };
          if (dateStr) {
            const startDate = new Date(dateStr);
            const endDate = new Date(dateStr);
            endDate.setDate(endDate.getDate() + 1);
            cond.purchaseDate = { $gte: startDate, $lt: endDate };
          }
          orConditions.push(cond);
        }

        // Product Name + Amount match (broad catch for identical items)
        if (prodName && prodName.length >= 3 && amount !== null && amount > 0) {
          orConditions.push({
            userId,
            amount: { $gte: amount - 0.01, $lte: amount + 0.01 },
            productName: { $regex: new RegExp('^' + PurchaseService._escapeRegExp(prodName) + '$', 'i') }
          });
        }

        if (orConditions.length > 0) {
          const existing = await Purchase.findOne({ $or: orConditions });
          if (existing) {
            const obj = existing.toObject();
            obj.id = obj._id.toString();
            return obj;
          }
        }
      } catch (err) {
        console.warn('[PurchaseService] Duplicate check DB warning:', err.message);
      }
    }

    // 2. Check in inMemoryPurchases store
    for (const item of inMemoryPurchases.values()) {
      if (String(item.userId) !== String(userId)) continue;

      if (invoiceNum && item.invoiceNumber && item.invoiceNumber.toLowerCase() === invoiceNum.toLowerCase()) return item;
      if (orderId && item.orderId && item.orderId.toLowerCase() === orderId.toLowerCase()) return item;
      if (serialNum && item.serialNumber && item.serialNumber.toLowerCase() === serialNum.toLowerCase()) return item;
      if (fileName && item.receiptFileName && item.receiptFileName === fileName) return item;

      if (prodName && amount !== null) {
        const itemProd = (item.productName || '').trim().toLowerCase();
        const itemMerch = (item.merchant || item.storeName || '').trim().toLowerCase();
        const itemAmt = parseFloat(item.amount !== undefined ? item.amount : item.price) || 0;

        if (merchant && itemProd === prodName.toLowerCase() && itemMerch === merchant.toLowerCase() && Math.abs(itemAmt - amount) < 0.05) {
          return item;
        }

        if (itemProd === prodName.toLowerCase() && Math.abs(itemAmt - amount) < 0.01) {
          return item;
        }
      }
    }

    return null;
  }

  /**
   * Calculate 10 behavioral features for ML-04 Purchase Behavior Clustering.
   * Strictly scoped to the authenticated user's own purchase records.
   *
   * Feature definitions match those used during training (train_clustering_model.py):
   *   purchase_count              : total number of purchases (all time)
   *   monthly_spend               : average monthly spend (last 90 days / 3 months)
   *   avg_purchase_amount         : total spend / purchase count
   *   online_purchase_ratio       : fraction of ONLINE purchases (0–1)
   *   electronics_spend           : electronics total / total spend (ratio 0–1)
   *   fashion_spend               : fashion total / total spend (ratio 0–1)
   *   food_spend                  : food category total / total spend (ratio 0–1)
   *   home_spend                  : home appliances total / total spend (ratio 0–1)
   *   other_spend                 : other categories total / total spend (ratio 0–1)
   *   avg_days_between_purchases  : average days between consecutive purchase dates
   *
   * @param {string} userId - Authenticated user ID (never mixing users' data)
   * @returns {Promise<{hasSufficientData: boolean, features?: object, purchaseCount: number}>}
   */
  static async calculateUserBehaviorFeatures(userId) {
    if (!userId) return { hasSufficientData: false, purchaseCount: 0 };

    const purchases = await PurchaseService.getPurchases(userId);
    const purchaseCount = purchases.length;

    // Minimum data safeguard: require at least 3 purchases for meaningful clustering
    if (purchaseCount < 3) {
      return { hasSufficientData: false, purchaseCount };
    }

    // ── Spend aggregation ───────────────────────────────────────────────────
    let totalSpend = 0;
    let onlineCount = 0;
    let electronicsSpend = 0;
    let fashionSpend = 0;
    let foodSpend = 0;
    let homeSpend = 0;
    let otherSpend = 0;

    // For monthly spend: use last 90 days (approx 3 months)
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    let recentSpend = 0;

    // For avg_days_between_purchases
    const sortedDates = purchases
      .map(p => p.purchaseDate ? new Date(p.purchaseDate) : null)
      .filter(Boolean)
      .sort((a, b) => a - b);

    for (const p of purchases) {
      const amt = parseFloat(p.amount !== undefined ? p.amount : p.price) || 0;
      const cat = (p.category || '').toLowerCase();
      const pType = (p.purchaseType || '').toUpperCase();
      const pDate = p.purchaseDate ? new Date(p.purchaseDate) : null;

      totalSpend += amt;

      if (pType === 'ONLINE') onlineCount++;

      if (cat.includes('electronics') || cat.includes('gadgets')) {
        electronicsSpend += amt;
      } else if (cat.includes('fashion')) {
        fashionSpend += amt;
      } else if (cat.includes('food') || cat.includes('grocer') || cat.includes('beverage')) {
        foodSpend += amt;
      } else if (cat.includes('home') || cat.includes('appliance') || cat.includes('furniture')) {
        homeSpend += amt;
      } else {
        otherSpend += amt;
      }

      if (pDate && pDate >= ninetyDaysAgo) {
        recentSpend += amt;
      }
    }

    // ── Feature calculations ────────────────────────────────────────────────
    const safeTotal = totalSpend > 0 ? totalSpend : 1;
    const avgPurchaseAmount = totalSpend / purchaseCount;

    // Monthly spend = average over 3 months (recentSpend / 3)
    const monthlySpend = recentSpend / 3;

    const onlinePurchaseRatio = purchaseCount > 0 ? onlineCount / purchaseCount : 0;

    // Spend ratios (0–1), clipped to valid range
    const electronicsRatio = Math.min(electronicsSpend / safeTotal, 1.0);
    const fashionRatio = Math.min(fashionSpend / safeTotal, 1.0);
    const foodRatio = Math.min(foodSpend / safeTotal, 1.0);
    const homeRatio = Math.min(homeSpend / safeTotal, 1.0);
    const otherRatio = Math.min(otherSpend / safeTotal, 1.0);

    // Average days between consecutive purchases
    let avgDaysBetween = 30 / Math.max(purchaseCount, 1); // fallback
    if (sortedDates.length >= 2) {
      let totalDays = 0;
      for (let i = 1; i < sortedDates.length; i++) {
        totalDays += (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
      }
      avgDaysBetween = totalDays / (sortedDates.length - 1);
    }

    return {
      hasSufficientData: true,
      purchaseCount,
      features: {
        purchase_count: purchaseCount,
        monthly_spend: Math.round(monthlySpend * 100) / 100,
        avg_purchase_amount: Math.round(avgPurchaseAmount * 100) / 100,
        online_purchase_ratio: Math.round(onlinePurchaseRatio * 10000) / 10000,
        electronics_spend: Math.round(electronicsRatio * 10000) / 10000,
        fashion_spend: Math.round(fashionRatio * 10000) / 10000,
        food_spend: Math.round(foodRatio * 10000) / 10000,
        home_spend: Math.round(homeRatio * 10000) / 10000,
        other_spend: Math.round(otherRatio * 10000) / 10000,
        avg_days_between_purchases: Math.round(avgDaysBetween * 100) / 100
      }
    };
  }

  /**
   * Calculate 7 numerical features for ML-03 Spending Anomaly Detection
   * strictly scoped to the logged-in user's purchase history.

   */
  static async calculateAnomalyFeatures(userId, purchaseData) {
    const purchaseAmount = parseFloat(purchaseData.amount !== undefined ? purchaseData.amount : purchaseData.price) || 0;
    const category = purchaseData.category || 'Electronics';

    const purchases = await PurchaseService.getPurchases(userId);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let userMonthlySpend = 0;
    let purchaseCountLast30Days = 0;
    let categorySum = 0;
    let categoryCount = 0;
    let totalSumAll = 0;
    let totalCountAll = 0;
    let mostRecentDate = null;

    for (const p of purchases) {
      const pAmt = parseFloat(p.amount !== undefined ? p.amount : p.price) || 0;
      const pDate = p.purchaseDate ? new Date(p.purchaseDate) : new Date();

      totalSumAll += pAmt;
      totalCountAll += 1;

      if (pDate >= thirtyDaysAgo) {
        userMonthlySpend += pAmt;
        purchaseCountLast30Days += 1;
      }

      if (p.category && p.category.toLowerCase() === category.toLowerCase()) {
        categorySum += pAmt;
        categoryCount += 1;
      }

      if (!mostRecentDate || pDate > mostRecentDate) {
        mostRecentDate = pDate;
      }
    }

    let categoryAveragePurchase = categoryCount > 0 ? (categorySum / categoryCount) : (totalCountAll > 0 ? (totalSumAll / totalCountAll) : purchaseAmount);
    if (categoryAveragePurchase <= 0) categoryAveragePurchase = purchaseAmount || 1;

    let daysSinceLastPurchase = 0;
    if (mostRecentDate) {
      const diffMs = now.getTime() - mostRecentDate.getTime();
      daysSinceLastPurchase = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    const monthlySpendForRatio = userMonthlySpend > 0 ? userMonthlySpend : purchaseAmount;
    const monthlySpendRatio = monthlySpendForRatio > 0 ? parseFloat((purchaseAmount / monthlySpendForRatio).toFixed(4)) : 1.0;
    const catAvgRatio = categoryAveragePurchase > 0 ? parseFloat((purchaseAmount / categoryAveragePurchase).toFixed(4)) : 1.0;

    return {
      purchase_amount: parseFloat(purchaseAmount.toFixed(2)),
      user_monthly_spend: parseFloat(userMonthlySpend.toFixed(2)),
      category_average_purchase: parseFloat(categoryAveragePurchase.toFixed(2)),
      purchase_count_last_30_days: purchaseCountLast30Days,
      days_since_last_purchase: daysSinceLastPurchase,
      amount_to_monthly_spend_ratio: monthlySpendRatio,
      amount_to_category_average_ratio: catAvgRatio
    };
  }

  /**
   * 1. CREATE PURCHASE
   * Saves purchase with all Task 2 fields directly into MongoDB Compass
   */
  static async createPurchase(userId, data) {
    // Duplicate check enforcement
    const duplicate = await PurchaseService.checkDuplicate(userId, data);
    if (duplicate) {
      const err = new Error('You already have this bill in the system.');
      err.statusCode = 409;
      err.duplicateItem = duplicate;
      throw err;
    }

    const purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : new Date();
    const warrantyMonths = parseInt(data.warrantyMonths, 10) || 12;
    const returnPeriodDays = parseInt(data.returnPeriodDays, 10) || 30;

    // Calculate dates
    const warrantyStart = data.warrantyStart ? new Date(data.warrantyStart) : new Date(purchaseDate);
    const warrantyEnd = data.warrantyEnd
      ? new Date(data.warrantyEnd)
      : new Date(new Date(warrantyStart).setMonth(warrantyStart.getMonth() + warrantyMonths));

    const returnDeadline = data.returnDeadline
      ? new Date(data.returnDeadline)
      : new Date(new Date(purchaseDate).setDate(purchaseDate.getDate() + returnPeriodDays));

    const now = new Date();
    const daysToExpiry = Math.ceil((warrantyEnd - now) / (1000 * 60 * 60 * 24));

    let status = data.status || 'active';
    if (status === 'active') {
      if (daysToExpiry < 0) status = 'expired';
      else if (daysToExpiry <= 30) status = 'expiring_soon';
    }

    const merchantName = (data.merchant || data.storeName || 'Retail Store').trim();
    const totalAmount = parseFloat(data.amount !== undefined ? data.amount : data.price) || 0;

    // Auto-predict Category via ML-01 model (trained on CSV) if category is missing or default 'Other'
    let assignedCategory = (data.category && data.category !== 'Other' && data.category.trim() !== '') ? data.category : null;
    if (!assignedCategory) {
      try {
        const mlPrediction = await MlService.predictCategory({
          productName: data.productName,
          brand: data.brand,
          storeName: merchantName,
          notes: data.notes,
          purchaseType: data.purchaseType,
          amount: totalAmount
        });
        if (mlPrediction && mlPrediction.predictedCategory) {
          assignedCategory = mlPrediction.predictedCategory;
        }
      } catch (mlErr) {
        console.warn('[PurchaseService] ML category prediction notice:', mlErr.message);
      }
    }

    if (!assignedCategory) {
      assignedCategory = PurchaseService.inferCategoryFromKeywords(data.productName, merchantName, data.notes);
    }

    // Evaluate ML-03 Spending Anomaly Detection
    let isAnomaly = false;
    let anomalyScore = 0;
    let anomalyNotice = '';
    try {
      const anomalyFeatures = await PurchaseService.calculateAnomalyFeatures(userId, { ...data, amount: totalAmount, category: assignedCategory });
      const anomalyResult = await MlService.detectSpendingAnomaly(anomalyFeatures);
      if (anomalyResult && anomalyResult.isAnomaly) {
        isAnomaly = true;
        anomalyScore = anomalyResult.anomalyScore;
        anomalyNotice = `⚠️ Unusual spending detected: ${(data.currency || '₹')}${totalAmount.toLocaleString()} is significantly higher than your usual purchase pattern.`;
      }
    } catch (anomErr) {
      console.warn('[PurchaseService] Anomaly calculation notice:', anomErr.message);
    }

    const purchasePayload = {
      userId,
      productName: (data.productName || 'New Purchase').trim(),
      brand: (data.brand || '').trim(),
      merchant: merchantName,
      storeName: merchantName, // alias
      category: assignedCategory,
      purchaseType: (data.purchaseType && data.purchaseType.toUpperCase() === 'OFFLINE') ? 'OFFLINE' : 'ONLINE',
      purchaseDate,
      amount: totalAmount,
      price: totalAmount, // alias
      currency: data.currency || 'PKR',
      quantity: parseInt(data.quantity, 10) || 1,
      tax: parseFloat(data.tax) || 0,
      discount: parseFloat(data.discount) || 0,
      paymentMethod: data.paymentMethod || 'Credit Card',
      orderId: (data.orderId || '').trim(),
      invoiceNumber: (data.invoiceNumber || '').trim(),
      serialNumber: (data.serialNumber || '').trim(),
      modelNumber: (data.modelNumber || '').trim(),
      returnPeriodDays,
      returnDeadline,
      warrantyMonths,
      warrantyStart,
      warrantyEnd,
      warrantyExpiresAt: warrantyEnd, // alias
      warrantyType: data.warrantyType || 'Manufacturer',
      receiptReference: data.receiptReference || '',
      receiptImageUrl: data.receiptImageUrl || '',
      receiptFileName: data.receiptFileName || '',
      notes: (data.notes || '').trim(),
      status,
      isAnomaly,
      anomalyScore,
      anomalyNotice,
      summary: data.summary || null
    };

    // Generate accurate natural-language summary if not already provided
    if (!purchasePayload.summary) {
      try {
        purchasePayload.summary = await ReceiptSummaryService.generateSummary({
          ...purchasePayload,
          ...data
        });
      } catch (sumErr) {
        console.warn('[PurchaseService] Summary generation notice:', sumErr.message);
        purchasePayload.summary = ReceiptSummaryService.generateDeterministicSummary(purchasePayload);
      }
    }

    // Save to MongoDB Compass
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = new Purchase(purchasePayload);
        const saved = await doc.save();
        const savedObj = saved.toObject();
        savedObj.id = savedObj._id.toString();
        inMemoryPurchases.set(savedObj.id, savedObj);

        // Sync summary to any matching Receipt document in MongoDB
        if (savedObj.summary && (savedObj.receiptFileName || savedObj.receiptReference)) {
          try {
            await Receipt.updateMany(
              {
                userId,
                $or: [
                  { purchaseId: savedObj._id },
                  { originalFileName: savedObj.receiptFileName || savedObj.receiptReference }
                ]
              },
              { $set: { summary: savedObj.summary, purchaseId: savedObj._id } }
            );
          } catch (rErr) {}
        }

        // RAG sync: index the new purchase asynchronously
        const rag = getRagIndex();
        if (rag) rag.indexPurchase(userId, savedObj).catch(() => {});
        return savedObj;
      } catch (err) {
        console.warn('MongoDB save warning, using memory fallback:', err.message);
      }
    }

    // In-memory fallback
    const memId = `pur_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const savedObj = {
      _id: memId,
      id: memId,
      ...purchasePayload,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemoryPurchases.set(memId, savedObj);
    // RAG sync: index the fallback purchase asynchronously
    const rag = getRagIndex();
    if (rag) rag.indexPurchase(userId, savedObj).catch(() => {});
    return savedObj;
  }

  /**
   * 2. GET PURCHASES
   * Retrieve list of purchases from MongoDB Compass with filters & sorting
   */
  static async getPurchases(userId, { category, status, purchaseType, search, sort = 'newest' } = {}) {
    let items = [];

    if (mongoose.connection.readyState === 1) {
      try {
        const query = { userId };
        if (category && category !== 'all') query.category = category;
        if (status && status !== 'all') query.status = status;
        if (purchaseType && purchaseType !== 'all') query.purchaseType = purchaseType;
        if (search) {
          query.$or = [
            { productName: { $regex: search, $options: 'i' } },
            { brand: { $regex: search, $options: 'i' } },
            { merchant: { $regex: search, $options: 'i' } },
            { storeName: { $regex: search, $options: 'i' } },
            { serialNumber: { $regex: search, $options: 'i' } },
            { invoiceNumber: { $regex: search, $options: 'i' } },
            { orderId: { $regex: search, $options: 'i' } }
          ];
        }

        let sortObj = { purchaseDate: -1 };
        if (sort === 'oldest') sortObj = { purchaseDate: 1 };
        else if (sort === 'price_high' || sort === 'amount_high') sortObj = { amount: -1 };
        else if (sort === 'price_low' || sort === 'amount_low') sortObj = { amount: 1 };
        else if (sort === 'expiry_soon') sortObj = { warrantyEnd: 1 };

        const docs = await Purchase.find(query).sort(sortObj);
        items = docs.map(d => {
          const obj = d.toObject();
          obj.id = obj._id.toString();
          return obj;
        });
      } catch (err) {
        console.warn('MongoDB query warning, using memory fallback:', err.message);
        items = [];
      }
    }

    // In-memory fallback — return whatever this user has (may be empty for new users)
    if (items.length === 0) {
      let userMemItems = Array.from(inMemoryPurchases.values()).filter(p => p.userId === userId);
      // No seeding — new users start with an empty vault

      items = userMemItems.filter(item => {
        if (category && category !== 'all' && item.category !== category) return false;
        if (status && status !== 'all' && item.status !== status) return false;
        if (purchaseType && purchaseType !== 'all' && item.purchaseType !== purchaseType) return false;
        if (search) {
          const s = search.toLowerCase();
          const matches =
            (item.productName && item.productName.toLowerCase().includes(s)) ||
            (item.brand && item.brand.toLowerCase().includes(s)) ||
            (item.merchant && item.merchant.toLowerCase().includes(s)) ||
            (item.storeName && item.storeName.toLowerCase().includes(s)) ||
            (item.serialNumber && item.serialNumber.toLowerCase().includes(s)) ||
            (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(s)) ||
            (item.orderId && item.orderId.toLowerCase().includes(s));
          if (!matches) return false;
        }
        return true;
      });

      items.sort((a, b) => {
        if (sort === 'oldest') return new Date(a.purchaseDate) - new Date(b.purchaseDate);
        if (sort === 'price_high' || sort === 'amount_high') return (b.amount || b.price) - (a.amount || a.price);
        if (sort === 'price_low' || sort === 'amount_low') return (a.amount || a.price) - (b.amount || b.price);
        if (sort === 'expiry_soon') return new Date(a.warrantyEnd || a.warrantyExpiresAt) - new Date(b.warrantyEnd || b.warrantyExpiresAt);
        return new Date(b.purchaseDate) - new Date(a.purchaseDate);
      });
    }

    // Dynamic calculations
    const now = new Date();
    return items.map(item => {
      const expiryDate = new Date(item.warrantyEnd || item.warrantyExpiresAt);
      const returnDate = new Date(item.returnDeadline);
      const daysUntilWarrantyExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      const daysUntilReturnDeadline = Math.ceil((returnDate - now) / (1000 * 60 * 60 * 24));

      return {
        ...item,
        merchant: item.merchant || item.storeName,
        storeName: item.storeName || item.merchant,
        amount: item.amount !== undefined ? item.amount : item.price,
        price: item.price !== undefined ? item.price : item.amount,
        warrantyEnd: item.warrantyEnd || item.warrantyExpiresAt,
        warrantyExpiresAt: item.warrantyExpiresAt || item.warrantyEnd,
        daysUntilWarrantyExpiry,
        daysUntilReturnDeadline,
        isReturnWindowActive: daysUntilReturnDeadline > 0,
        isWarrantyActive: daysUntilWarrantyExpiry > 0
      };
    });
  }

  /**
   * 3. GET SINGLE PURCHASE
   */
  static async getPurchaseById(id, userId) {
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await Purchase.findOne({ _id: id, userId });
        if (doc) {
          const obj = doc.toObject();
          obj.id = obj._id.toString();
          return obj;
        }
      } catch (err) {}
    }

    const item = inMemoryPurchases.get(id);
    if (item && item.userId === userId) {
      return item;
    }
    return null;
  }

  /**
   * 4. UPDATE PURCHASE
   */
  static async updatePurchase(id, userId, updateData) {
    if (updateData.purchaseDate && updateData.warrantyMonths) {
      const pDate = new Date(updateData.purchaseDate);
      const wExp = new Date(pDate);
      wExp.setMonth(wExp.getMonth() + parseInt(updateData.warrantyMonths, 10));
      updateData.warrantyEnd = wExp;
      updateData.warrantyExpiresAt = wExp;
    }

    if (updateData.purchaseDate && updateData.returnPeriodDays) {
      const pDate = new Date(updateData.purchaseDate);
      const rDead = new Date(pDate);
      rDead.setDate(rDead.getDate() + parseInt(updateData.returnPeriodDays, 10));
      updateData.returnDeadline = rDead;
    }

    if (updateData.merchant && !updateData.storeName) updateData.storeName = updateData.merchant;
    if (updateData.storeName && !updateData.merchant) updateData.merchant = updateData.storeName;
    if (updateData.amount !== undefined && updateData.price === undefined) updateData.price = updateData.amount;
    if (updateData.price !== undefined && updateData.amount === undefined) updateData.amount = updateData.price;

    // Check if summary needs regeneration
    if (!updateData.summary && (updateData.productName || updateData.amount || updateData.merchant || updateData.purchaseDate || updateData.warrantyMonths)) {
      try {
        const existing = await PurchaseService.getPurchaseById(id, userId);
        if (existing) {
          updateData.summary = await ReceiptSummaryService.generateSummary({
            ...existing,
            ...updateData
          });
        }
      } catch (e) {}
    }

    if (mongoose.connection.readyState === 1) {
      try {
        const updated = await Purchase.findOneAndUpdate(
          { _id: id, userId },
          { $set: updateData },
          { returnDocument: 'after' }
        );
        if (updated) {
          const obj = updated.toObject();
          obj.id = obj._id.toString();
          inMemoryPurchases.set(id, obj);
          // RAG sync: re-index the updated purchase asynchronously
          const rag = getRagIndex();
          if (rag) rag.indexPurchase(userId, obj).catch(() => {});
          return obj;
        }
      } catch (err) {}
    }

    const existing = inMemoryPurchases.get(id);
    if (existing && existing.userId === userId) {
      const merged = { ...existing, ...updateData, updatedAt: new Date() };
      inMemoryPurchases.set(id, merged);
      // RAG sync: re-index the updated purchase asynchronously
      const rag = getRagIndex();
      if (rag) rag.indexPurchase(userId, merged).catch(() => {});
      return merged;
    }
    return null;
  }

  /**
   * 5. DELETE PURCHASE
   */
  static async deletePurchase(id, userId) {
    let deleted = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const res = await Purchase.deleteOne({ _id: id, userId });
        deleted = res.deletedCount > 0;
      } catch (err) {}
    }

    const memItem = inMemoryPurchases.get(id);
    if (memItem && memItem.userId === userId) {
      inMemoryPurchases.delete(id);
      deleted = true;
    }

    // RAG sync: remove the deleted purchase from the index
    if (deleted) {
      const rag = getRagIndex();
      if (rag) rag.deletePurchase(id, userId).catch(() => {});
    }
    return deleted;
  }

  /**
   * Analytics & Stats Calculation
   */
  static async getSpendingAnalytics(userId) {
    const purchases = await PurchaseService.getPurchases(userId);
    const now = new Date();

    let totalSpend = 0;
    let activeWarrantiesValue = 0;
    let activeWarrantyCount = 0;
    let upcomingReturnsCount = 0;
    let urgentReturnsCount = 0;
    let expiringWarrantiesCount = 0;
    let moneyAtRisk = 0;
    let thisMonthSpend = 0;

    const categoryBreakdown = {};
    const monthlySpend = {};
    const retailerSpend = {};
    const warrantyDistribution = { active: 0, expiring_soon: 0, expired: 0, returned: 0, claimed: 0 };

    const currentMonthKey = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    for (const p of purchases) {
      const val = parseFloat(p.amount !== undefined ? p.amount : p.price) || 0;
      totalSpend += val;

      const rawExp = p.warrantyEnd || p.warrantyExpiresAt;
      const expDate = rawExp ? new Date(rawExp) : null;
      const rawRet = p.returnDeadline;
      const retDate = rawRet ? new Date(rawRet) : null;
      const daysToWarranty = (expDate && !isNaN(expDate.getTime())) ? Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)) : -999;
      const daysToReturn = (retDate && !isNaN(retDate.getTime())) ? Math.ceil((retDate - now) / (1000 * 60 * 60 * 24)) : -999;

      if (daysToWarranty > 0) {
        activeWarrantiesValue += val;
        activeWarrantyCount++;
      }
      if (daysToReturn > 0) {
        upcomingReturnsCount++;
      }
      if (daysToReturn > 0 && daysToReturn <= 7) urgentReturnsCount++;
      if (daysToWarranty > 0 && daysToWarranty <= 30) expiringWarrantiesCount++;

      // Money at risk: value tied to return windows closing soon or warranties expiring soon
      if ((daysToReturn > 0 && daysToReturn <= 7) || (daysToWarranty > 0 && daysToWarranty <= 30)) {
        moneyAtRisk += val;
      }

      const pDate = p.purchaseDate ? new Date(p.purchaseDate) : (p.createdAt ? new Date(p.createdAt) : now);
      const monthLabel = (!isNaN(pDate.getTime())) ? pDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : currentMonthKey;
      if (monthLabel === currentMonthKey) thisMonthSpend += val;

      if (p.status in warrantyDistribution) warrantyDistribution[p.status]++;
      else warrantyDistribution.active++;

      const cat = p.category || 'Other';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + val;

      const store = p.merchant || p.storeName || 'Other Retailer';
      retailerSpend[store] = (retailerSpend[store] || 0) + val;

      monthlySpend[monthLabel] = (monthlySpend[monthLabel] || 0) + val;
    }

    const monthKeys = Object.keys(monthlySpend);
    const monthlyLabels = monthKeys.length > 0 ? monthKeys : [];
    const monthlyValues = monthKeys.length > 0 ? monthKeys.map(k => monthlySpend[k]) : [];

    // ── ML-02: Spending Forecasting ──────────────────────────────────────────
    // Calculate 12 real-user features aligned with train_spending_model.py definitions.
    // Falls back to simple average if ML service is offline or features are insufficient.
    const monthsWithData = monthlyValues.filter(v => v > 0);
    const avgMonthly = monthsWithData.length > 0
      ? monthsWithData.reduce((a, b) => a + b, 0) / monthsWithData.length
      : 0;

    // Simple statistical fallback (used when ML service is unavailable)
    const fallbackPrediction = Math.round(avgMonthly * 100) / 100;

    // Attempt ML-02 prediction
    let prediction = fallbackPrediction;
    let predictionIsML = false;
    let predictionModelName = null;
    let predictionModelVersion = null;
    try {
      const spendingFeatures = PurchaseService.calculateUserSpendingFeatures(purchases, now);
      if (spendingFeatures) {
        const mlResult = await MlService.predictNextMonthSpending(spendingFeatures);
        if (mlResult && typeof mlResult.predictedNextMonthSpend === 'number') {
          prediction = Math.round(mlResult.predictedNextMonthSpend * 100) / 100;
          predictionIsML = true;
          predictionModelName = mlResult.modelName;
          predictionModelVersion = mlResult.modelVersion;
        }
      }
    } catch (mlErr) {
      console.warn('[PurchaseService] ML spending prediction error (fallback in use):', mlErr.message);
    }
    // ── End ML-02 ─────────────────────────────────────────────────────────────

    // ── Continuous Chronological Timeline Builder ─────────────────────────────
    // Generates complete continuous month sequences (filling inactive months with 0)
    // so line charts form smooth, informative curves rather than disconnected single dots.
    let anchorDate = now;
    if (purchases.length > 0) {
      const purchaseDates = purchases
        .map(p => p.purchaseDate ? new Date(p.purchaseDate) : null)
        .filter(Boolean);
      if (purchaseDates.length > 0) {
        anchorDate = new Date(Math.max(...purchaseDates));
      }
    }

    const getContinuousTimeline = (numMonths) => {
      const labels = [];
      const values = [];
      const cumulative = [];

      for (let i = numMonths - 1; i >= 0; i--) {
        const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
        const endOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i + 1, 0, 23, 59, 59, 999);
        const mKey = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        labels.push(mKey);

        const monthVal = Math.round((monthlySpend[mKey] || 0) * 100) / 100;
        values.push(monthVal);

        // Cumulative sum of all purchases made on or before the end of this month
        const cumVal = purchases
          .filter(p => {
            const pDate = p.purchaseDate ? new Date(p.purchaseDate) : null;
            return pDate && pDate <= endOfMonth;
          })
          .reduce((sum, p) => sum + (parseFloat(p.amount !== undefined ? p.amount : p.price) || 0), 0);
        cumulative.push(Math.round(cumVal * 100) / 100);
      }

      return { labels, values, cumulative };
    };

    const timeline6M = getContinuousTimeline(6);
    const timeline1Y = getContinuousTimeline(12);

    // All-time timeline from earliest purchase
    let allMonthsCount = 6;
    if (purchases.length > 0) {
      const pDates = purchases.map(p => p.purchaseDate ? new Date(p.purchaseDate) : null).filter(Boolean);
      if (pDates.length > 0) {
        const minDate = new Date(Math.min(...pDates));
        const diffMonths = (anchorDate.getFullYear() - minDate.getFullYear()) * 12 + (anchorDate.getMonth() - minDate.getMonth()) + 1;
        allMonthsCount = Math.max(diffMonths, 6);
      }
    }
    const timelineAll = getContinuousTimeline(Math.min(allMonthsCount, 36));

    // Next month label for ML-02 forecast plotting
    const nextMonthDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
    const nextMonthLabel = nextMonthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    // ── Category Allocation & Breakdown Details ──────────────────────────────
    const CATEGORY_COLORS = {
      'Electronics': '#3B82F6',
      'Gadgets': '#06B6D4',
      'Fashion': '#EC4899',
      'Home Appliances': '#8B5CF6',
      'Food & Beverages': '#10B981',
      'Food & Groceries': '#10B981',
      'Furniture': '#F59E0B',
      'Vehicles': '#6366F1',
      'Office': '#14B8A6',
      'Sports': '#F97316',
      'Other': '#64748B'
    };

    const sortedCats = Object.entries(categoryBreakdown)
      .map(([cat, amt]) => {
        const count = purchases.filter(p => (p.category || 'Other') === cat).length;
        const pct = totalSpend > 0 ? Math.round((amt / totalSpend) * 1000) / 10 : 0;
        return {
          category: cat,
          amount: Math.round(amt * 100) / 100,
          count,
          percentage: pct,
          color: CATEGORY_COLORS[cat] || '#8B5CF6'
        };
      })
      .sort((a, b) => b.amount - a.amount);

    const catLabels = sortedCats.map(c => c.category);
    const catValues = sortedCats.map(c => c.amount);

    return {
      metrics: {
        totalSpend: {
          value: Math.round(totalSpend * 100) / 100,
          trend: 12.4
        },
        thisMonthSpend: {
          value: Math.round(thisMonthSpend * 100) / 100,
          subText: `Spent in ${currentMonthKey}`
        },
        totalItemsCount: purchases.length,
        activeWarrantiesValue: {
          value: Math.round(activeWarrantiesValue * 100) / 100,
          count: activeWarrantyCount
        },
        activeWarrantyCount,
        urgentReturns: {
          count: urgentReturnsCount,
          subText: `${urgentReturnsCount} return windows ending in < 7 days`
        },
        upcomingReturnsCount,
        expiringWarranties: {
          count: expiringWarrantiesCount,
          subText: `${expiringWarrantiesCount} warranties expiring in < 30 days`
        },
        moneyAtRisk: {
          value: Math.round(moneyAtRisk * 100) / 100,
          count: expiringWarrantiesCount + urgentReturnsCount,
          subText: 'Value tied to deadlines closing in the next 30 days'
        },
        spendingPrediction: {
          value: prediction,
          isMLPrediction: predictionIsML,
          modelName: predictionModelName,
          modelVersion: predictionModelVersion,
          subText: predictionIsML
            ? `ML forecast (${predictionModelName || 'model'})` 
            : 'Projected next month based on your spending average'
        }
      },
      charts: {
        spendingTrend: {
          labels: timeline6M.labels,
          values: timeline6M.values,
          cumulative: timeline6M.cumulative,
          ranges: {
            '6m': timeline6M,
            '1y': timeline1Y,
            'all': timelineAll
          },
          forecast: {
            label: nextMonthLabel,
            value: prediction,
            isML: predictionIsML
          }
        },
        categoryAllocation: {
          labels: catLabels.length ? catLabels : [],
          values: catValues.length ? catValues : [],
          colors: sortedCats.map(c => c.color),
          breakdown: sortedCats
        },
        warrantyHealth: {
          labels: ['Active Coverage', 'Expiring Soon (<30d)', 'Expired', 'Claimed/Returned'],
          values: [
            warrantyDistribution.active,
            warrantyDistribution.expiring_soon,
            warrantyDistribution.expired,
            warrantyDistribution.claimed + warrantyDistribution.returned
          ]
        },
        topRetailers: Object.entries(retailerSpend)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, amount]) => ({ name, amount }))
      }
    };
  }

  /**
   * Deadlines & Alerts
   */
  static async getDeadlinesAndAlerts(userId) {
    const purchases = await PurchaseService.getPurchases(userId);
    const now = new Date();

    const returnAlerts = [];
    const warrantyAlerts = [];

    for (const p of purchases) {
      const expDate = new Date(p.warrantyEnd || p.warrantyExpiresAt);
      const retDate = new Date(p.returnDeadline);
      const daysToWarranty = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
      const daysToReturn = Math.ceil((retDate - now) / (1000 * 60 * 60 * 24));

      if (daysToReturn >= 0 && daysToReturn <= 14) {
        returnAlerts.push({
          purchaseId: p.id,
          productName: p.productName,
          merchant: p.merchant || p.storeName,
          storeName: p.storeName || p.merchant,
          amount: p.amount !== undefined ? p.amount : p.price,
          price: p.price !== undefined ? p.price : p.amount,
          currency: p.currency,
          daysLeft: daysToReturn,
          deadlineDate: retDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          urgency: daysToReturn <= 3 ? 'critical' : daysToReturn <= 7 ? 'urgent' : 'moderate',
          receiptImageUrl: p.receiptImageUrl
        });
      }

      if (daysToWarranty >= 0 && daysToWarranty <= 60) {
        warrantyAlerts.push({
          purchaseId: p.id,
          productName: p.productName,
          brand: p.brand,
          merchant: p.merchant || p.storeName,
          storeName: p.storeName || p.merchant,
          serialNumber: p.serialNumber,
          amount: p.amount !== undefined ? p.amount : p.price,
          price: p.price !== undefined ? p.price : p.amount,
          currency: p.currency,
          daysLeft: daysToWarranty,
          expiryDate: expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          urgency: daysToWarranty <= 10 ? 'critical' : daysToWarranty <= 30 ? 'warning' : 'info',
          receiptImageUrl: p.receiptImageUrl
        });
      }
    }

    returnAlerts.sort((a, b) => a.daysLeft - b.daysLeft);
    warrantyAlerts.sort((a, b) => a.daysLeft - b.daysLeft);

    return {
      returnAlerts,
      warrantyAlerts,
      summary: {
        urgentReturnCount: returnAlerts.length,
        expiringWarrantyCount: warrantyAlerts.length
      }
    };
  }

  /**
   * Export Purchases Data
   */
  static async exportData(userId, format = 'csv') {
    const purchases = await PurchaseService.getPurchases(userId);

    if (format === 'json') {
      return {
        contentType: 'application/json',
        filename: `SmartPurchase_Vault_${new Date().toISOString().split('T')[0]}.json`,
        data: JSON.stringify(purchases, null, 2)
      };
    }

    const headers = [
      'Product Name',
      'Brand',
      'Merchant',
      'Category',
      'Purchase Type',
      'Purchase Date',
      'Amount',
      'Quantity',
      'Tax',
      'Discount',
      'Payment Method',
      'Order ID',
      'Invoice Number',
      'Serial Number',
      'Return Deadline',
      'Warranty Start',
      'Warranty End',
      'Status'
    ];

    const rows = purchases.map(p => [
      `"${(p.productName || '').replace(/"/g, '""')}"`,
      `"${(p.brand || '').replace(/"/g, '""')}"`,
      `"${(p.merchant || p.storeName || '').replace(/"/g, '""')}"`,
      `"${p.category || ''}"`,
      `"${p.purchaseType || 'ONLINE'}"`,
      new Date(p.purchaseDate).toISOString().split('T')[0],
      p.amount !== undefined ? p.amount : p.price || 0,
      p.quantity || 1,
      p.tax || 0,
      p.discount || 0,
      `"${p.paymentMethod || ''}"`,
      `"${p.orderId || ''}"`,
      `"${p.invoiceNumber || ''}"`,
      `"${p.serialNumber || ''}"`,
      new Date(p.returnDeadline).toISOString().split('T')[0],
      new Date(p.warrantyStart || p.purchaseDate).toISOString().split('T')[0],
      new Date(p.warrantyEnd || p.warrantyExpiresAt).toISOString().split('T')[0],
      `"${p.status || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    return {
      contentType: 'text/csv',
      filename: `SmartPurchase_Vault_${new Date().toISOString().split('T')[0]}.csv`,
      data: csvContent
    };
  }

  /**
   * Check all purchases for a user and send warranty reminder emails
   * when the warranty is approaching (30, 15, or 7 days away).
   * Prevents duplicate reminders using the warrantyRemindersSent field.
   */
  static async checkAndSendWarrantyReminders(userId, user) {
    if (!EmailService.isEmailConfigured()) return;
    if (!user || !user.email) return;

    const purchases = await PurchaseService.getPurchases(userId);
    const now = new Date();

    const reminderThresholds = [
      { days: 30, type: '30day' },
      { days: 15, type: '15day' },
      { days: 7, type: '7day' }
    ];

    for (const purchase of purchases) {
      const warrantyEnd = new Date(purchase.warrantyEnd || purchase.warrantyExpiresAt);
      if (!warrantyEnd || isNaN(warrantyEnd.getTime())) continue;

      const daysUntilExpiry = Math.ceil((warrantyEnd - now) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry < 0) continue; // Already expired

      for (const threshold of reminderThresholds) {
        // Send reminder if warranty expires within threshold days but more than threshold-1 days
        if (daysUntilExpiry > threshold.days - 1 && daysUntilExpiry <= threshold.days) {
          // Check if this reminder type was already sent
          const alreadySent = await PurchaseService.hasReminderBeenSent(
            purchase.id || purchase._id, userId, threshold.type
          );
          if (alreadySent) continue;

          // Send the email
          const result = await EmailService.sendWarrantyReminder({
            recipientEmail: user.email,
            userName: user.name || 'User',
            purchase,
            daysUntilExpiry
          });

          // Record that the reminder was sent
          if (result.success) {
            await PurchaseService.recordReminderSent(
              purchase.id || purchase._id, userId, threshold.type, daysUntilExpiry
            );
          }
        }
      }
    }
  }

  /**
   * Manually send a warranty reminder email for a specific purchase.
   */
  static async sendManualWarrantyReminder(purchaseId, userId, user) {
    if (!EmailService.isEmailConfigured()) {
      return { success: false, message: 'Email service not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD in backend/.env' };
    }
    if (!user || !user.email) {
      return { success: false, message: 'User email not found. Please update your profile.' };
    }

    const purchase = await PurchaseService.getPurchaseById(purchaseId, userId);
    if (!purchase) {
      return { success: false, message: 'Purchase not found.' };
    }

    const warrantyEnd = new Date(purchase.warrantyEnd || purchase.warrantyExpiresAt);
    if (!warrantyEnd || isNaN(warrantyEnd.getTime())) {
      return { success: false, message: 'No warranty expiry date found for this purchase.' };
    }

    const daysUntilExpiry = Math.ceil((warrantyEnd - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) {
      return { success: false, message: 'Warranty for this product has already expired.' };
    }

    const result = await EmailService.sendWarrantyReminder({
      recipientEmail: user.email,
      userName: user.name || 'User',
      purchase,
      daysUntilExpiry
    });

    // Record manual reminder
    if (result.success) {
      await PurchaseService.recordReminderSent(
        purchase.id || purchase._id, userId, 'manual', daysUntilExpiry
      );
    }

    return result;
  }

  /**
   * Check if a specific reminder type has already been sent for a purchase.
   * userId is required to prevent touching another user's purchase record.
   */
  static async hasReminderBeenSent(purchaseId, userId, reminderType) {
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await Purchase.findOne({ _id: purchaseId, userId });
        if (doc && doc.warrantyRemindersSent) {
          return doc.warrantyRemindersSent.some(r => r.reminderType === reminderType);
        }
      } catch (err) {}
    }

    // In-memory fallback
    const item = inMemoryPurchases.get(purchaseId);
    if (item && item.userId === userId && item.warrantyRemindersSent) {
      return item.warrantyRemindersSent.some(r => r.reminderType === reminderType);
    }
    return false;
  }

  /**
   * Record that a warranty reminder has been sent.
   * userId is required to prevent updating another user's purchase record.
   */
  static async recordReminderSent(purchaseId, userId, reminderType, daysUntilExpiry) {
    const reminderRecord = {
      sentAt: new Date(),
      daysUntilExpiry,
      reminderType
    };

    if (mongoose.connection.readyState === 1) {
      try {
        await Purchase.findOneAndUpdate(
          { _id: purchaseId, userId },
          { $push: { warrantyRemindersSent: reminderRecord } }
        );
      } catch (err) {}
    }

    // In-memory fallback
    const item = inMemoryPurchases.get(purchaseId);
    if (item && item.userId === userId) {
      if (!item.warrantyRemindersSent) item.warrantyRemindersSent = [];
      item.warrantyRemindersSent.push(reminderRecord);
    }
  }
  /**
   * Calculate the 12 spending features for ML-02 prediction, using the same window
   * and category definitions as train_spending_model.py.
   *
   * Window definitions (must match training CSV exactly):
   *   M-1 = most recent complete calendar month before `now`
   *   M-2 = calendar month two months before `now`
   *   M-3 = calendar month three months before `now`
   *
   * Category mapping (must match training CSV exactly):
   *   electronics_spend : category == 'Electronics'
   *   fashion_spend     : category == 'Fashion'
   *   food_spend        : category in ['Food & Beverages', 'Food & Groceries']
   *   home_spend        : category in ['Home Appliances', 'Furniture']
   *   other_spend       : all remaining categories
   *
   * @param {Array} purchases - All user purchases (already enriched by getPurchases)
   * @param {Date}  now       - Reference date for window calculation (usually new Date())
   * @returns {object|null}   - Feature object or null if insufficient data (< 1 purchase in M-1..M-3)
   */
  static calculateUserSpendingFeatures(purchases, now) {
    if (!purchases || purchases.length === 0) return null;

    // Build month boundaries for M-1, M-2, M-3
    // A "complete calendar month" means we use the previous month relative to `now`.
    const getMonthWindow = (monthsBack) => {
      const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
      const end   = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1); // exclusive
      return { start, end };
    };

    const w1 = getMonthWindow(1); // M-1: most recent complete month
    const w2 = getMonthWindow(2); // M-2
    const w3 = getMonthWindow(3); // M-3

    const purchasesInWindow = (start, end) =>
      purchases.filter(p => {
        const d = new Date(p.purchaseDate);
        return d >= start && d < end;
      });

    const spendInWindow = (start, end) =>
      purchasesInWindow(start, end).reduce((sum, p) => sum + (p.amount !== undefined ? p.amount : (p.price || 0)), 0);

    const m1Purchases = purchasesInWindow(w1.start, w1.end);
    const previous_month_spend  = spendInWindow(w1.start, w1.end);
    const spend_2_months_ago    = spendInWindow(w2.start, w2.end);
    const spend_3_months_ago    = spendInWindow(w3.start, w3.end);

    // Require at least some data in the 3-month window to make a meaningful prediction
    if (previous_month_spend === 0 && spend_2_months_ago === 0 && spend_3_months_ago === 0) {
      return null;
    }

    const avg_3_month_spend = (previous_month_spend + spend_2_months_ago + spend_3_months_ago) / 3;
    const purchase_count = m1Purchases.length;
    const avg_purchase_amount = purchase_count > 0 ? previous_month_spend / purchase_count : 0;

    // online_purchase_ratio: fraction of M-1 purchases with purchaseType == 'ONLINE'
    const onlineCount = m1Purchases.filter(p => (p.purchaseType || '').toUpperCase() === 'ONLINE').length;
    const online_purchase_ratio = purchase_count > 0 ? onlineCount / purchase_count : 0;

    // Category spend in M-1 — definitions must exactly match training CSV
    const FOOD_CATS   = new Set(['Food & Beverages', 'Food & Groceries']);
    const HOME_CATS   = new Set(['Home Appliances', 'Furniture']);

    let electronics_spend = 0;
    let fashion_spend     = 0;
    let food_spend        = 0;
    let home_spend        = 0;
    let other_spend       = 0;

    for (const p of m1Purchases) {
      const amt = p.amount !== undefined ? p.amount : (p.price || 0);
      const cat = (p.category || '').trim();

      if (cat === 'Electronics')       electronics_spend += amt;
      else if (cat === 'Fashion')      fashion_spend     += amt;
      else if (FOOD_CATS.has(cat))     food_spend        += amt;
      else if (HOME_CATS.has(cat))     home_spend        += amt;
      else                             other_spend       += amt;
    }

    return {
      previous_month_spend:   Math.round(previous_month_spend * 100)  / 100,
      spend_2_months_ago:     Math.round(spend_2_months_ago * 100)    / 100,
      spend_3_months_ago:     Math.round(spend_3_months_ago * 100)    / 100,
      avg_3_month_spend:      Math.round(avg_3_month_spend * 100)     / 100,
      purchase_count,
      avg_purchase_amount:    Math.round(avg_purchase_amount * 100)   / 100,
      online_purchase_ratio:  Math.round(online_purchase_ratio * 10000) / 10000,
      electronics_spend:      Math.round(electronics_spend * 100)     / 100,
      fashion_spend:          Math.round(fashion_spend * 100)         / 100,
      food_spend:             Math.round(food_spend * 100)            / 100,
      home_spend:             Math.round(home_spend * 100)            / 100,
      other_spend:            Math.round(other_spend * 100)           / 100
    };
  }
}

module.exports = PurchaseService;
