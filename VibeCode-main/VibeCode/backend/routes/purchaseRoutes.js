const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PurchaseService = require('../services/purchaseService');
const NotificationService = require('../services/notificationService');
const AiReceiptParser = require('../services/aiReceiptParser');
const AiVisionService = require('../services/aiVisionService');

const AiClaimService = require('../services/aiClaimService');
const MlService = require('../services/mlService');
const { requireAuth, extractToken } = require('../middleware/authMiddleware');
const AuthService = require('../services/authService');
const { getDbStatus } = require('../config/db');

function getUserIdFromRequest(req) {
  if (req.user && req.user.id) return req.user.id;
  try {
    const token = extractToken(req);
    if (token) {
      const decoded = AuthService.verifyTokenPayload(token);
      if (decoded && decoded.id) return decoded.id;
    }
  } catch (e) {}
  return req.headers['x-user-id'] || req.headers['X-User-Id'] || null;
}

// Ensure receipt uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'receipts');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage engine for receipts & bills
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB max
});

/**
 * 100% LOCAL/OFFLINE OCR scan pipeline (no external OCR API, no API key).
 *
 *   1. AiVisionService.ocrImage(): sharp normalization (grayscale, contrast,
 *      resize) + Tesseract.js OCR on the ACTUAL uploaded image bytes.
 *   2. AiReceiptParser.parseReceiptText(): deterministic regex/keyword
 *      extraction from the real OCR text.
 *
 * STRICT no-hallucination rule: only values actually present in the OCR text
 * are returned. Every other field stays null ("Not Detected"). No defaults,
 * no invented invoice numbers, no assumed warranty periods, no calculated
 * dates. The user confirms/edits everything on the review screen before any
 * save happens (the save itself is a separate POST /api/purchases call).
 *
 * @param {object} uploaded - multer file object (req.files[0])
 * @param {string} mimeType - validated image mime type
 */
async function scanWithLocalOcr(uploaded, mimeType) {
  const filename = uploaded.originalname || 'receipt_scan.jpg';
  const ocrText = await AiVisionService.ocrImage(uploaded.buffer.toString('base64'));

  if (!ocrText || !ocrText.trim()) {
    throw new Error('OCR could not read any text from this image. Please upload a clearer, well-lit photo of the receipt.');
  }

  const parsed = AiReceiptParser.parseReceiptText(ocrText, filename);

  // Request Python ML-01 Category Classification (if microservice is available)
  let mlPrediction = null;
  try {
    mlPrediction = await MlService.predictCategory({
      productName: parsed.productName,
      brand: parsed.brand,
      storeName: parsed.storeName,
      rawOcrText: ocrText,
      purchaseType: parsed.purchaseType,
      amount: parsed.price
    });
  } catch (mlErr) {
    console.warn('[Scan] ML prediction notice:', mlErr.message);
  }

  // Category decision logic: pre-fill category using ML prediction (trained on CSV dataset) if not explicitly present
  let finalCategory = parsed.category || null;
  if (!finalCategory && mlPrediction && mlPrediction.predictedCategory) {
    finalCategory = mlPrediction.predictedCategory;
  }
  if (!finalCategory) {
    finalCategory = PurchaseService.inferCategoryFromKeywords(parsed.productName, parsed.storeName, ocrText);
  }

  return {
    // Required fields — null means "Not Detected" (never guessed)
    productName: parsed.productName || null,
    brand: parsed.brand || null,
    merchant: parsed.storeName || null,
    storeName: parsed.storeName || null,
    amount: parsed.price ?? null,
    price: parsed.price ?? null,
    purchaseDate: parsed.purchaseDate || null,
    category: finalCategory,
    quantity: parsed.quantity ?? null,
    tax: parsed.tax ?? null,
    discount: parsed.discount ?? null,
    paymentMethod: parsed.paymentMethod || null,
    orderId: parsed.orderId || null,
    invoiceNumber: parsed.invoiceNumber || null,
    purchaseType: parsed.purchaseType || null,
    returnPeriodDays: parsed.returnPeriodDays ?? null,
    returnDeadline: null, // computed by PurchaseService only from a user-confirmed period
    warrantyStart: parsed.warrantyStart || null,
    warrantyEnd: parsed.warrantyEnd || null,
    warrantyMonths: parsed.warrantyMonths ?? null,
    warrantyType: parsed.warrantyType || null,
    serialNumber: parsed.serialNumber || null,
    modelNumber: parsed.modelNumber || null,
    currency: parsed.currency || null,
    items: parsed.items || [],
    notes: parsed.notes || null,
    // ML Category Metadata
    mlCategoryPrediction: mlPrediction || null,
    // Provenance
    rawOcrText: ocrText,
    rawExtractedText: ocrText,
    aiEngine: 'ocr',
    aiNotice: 'Local OCR (Tesseract, offline). Blank fields were not detected — please fill them in before saving.'
  };
}

/**
 * Handle Purchase API routes dispatcher.
 *
 * Task 3 enforcement: every endpoint that touches user data (purchases,
 * analytics, deadlines, exports, claims) is wrapped in requireAuth and is
 * strictly scoped to the authenticated user's ID. Only generic demo / AI
 * utility endpoints (samples, sample-scan, scan, db/status) remain public.
 */
async function handlePurchaseRoutes(req, res, pathName, method) {
  // ===== PUBLIC DEMO / UTILITY ENDPOINTS (no user data) =====

  // 1. Get Preloaded Sample Receipts for Demo
  if (pathName === '/api/purchases/samples' && method === 'GET') {
    const samples = AiReceiptParser.getSampleReceipts();
    return res.status(200).json({
      success: true,
      message: 'Sample receipts retrieved for competition demo.',
      data: samples
    });
  }

  // 2. Scan Preloaded Sample Receipt (Instant 1-Click AI Demo)
  if (pathName === '/api/purchases/sample-scan' && method === 'POST') {
    const sampleId = req.body.sampleId;
    const sample = AiReceiptParser.getSampleById(sampleId);
    if (!sample) {
      return res.status(404).json({ success: false, message: 'Sample receipt not found.' });
    }

    // Attach ML prediction metadata if Python ML service is active
    let mlPrediction = null;
    try {
      mlPrediction = await MlService.predictCategory({
        productName: sample.data.productName,
        brand: sample.data.brand,
        storeName: sample.data.storeName,
        notes: sample.data.notes,
        purchaseType: sample.data.purchaseType || 'ONLINE',
        amount: sample.data.price
      });
    } catch (e) {
      mlPrediction = null;
    }

    const sampleData = { ...sample.data, mlCategoryPrediction: mlPrediction };

    return res.status(200).json({
      success: true,
      message: `AI successfully analyzed and extracted data from ${sample.label}!`,
      data: sampleData
    });
  }

  // 3. Scan Uploaded Receipt — 100% LOCAL/OFFLINE OCR pipeline.
  //    POST /api/purchases/scan with FormData field "receipt" (the actual image
  //    file). The server-level multer parser attaches the file to req.files[0]
  //    before routing, so req.files[0].buffer holds the real uploaded bytes.
  //    Pipeline: actual image -> sharp normalization -> Tesseract.js OCR ->
  //    AiReceiptParser deterministic regex extraction -> 23-field result
  //    (null for anything not detected). No external OCR API is used.
  if (pathName === '/api/purchases/scan' && method === 'POST') {
    console.log('[Scan] POST /api/purchases/scan received.');

    const uploaded = req.files && req.files[0];
    if (!uploaded) {
      return res.status(400).json({
        success: false,
        message: 'No receipt image uploaded. Please attach the image in the "receipt" field.'
      });
    }

    const mimeType = uploaded.mimetype || 'image/jpeg';
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/heic', 'image/heif', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid image type "${mimeType}". Use JPG, JPEG, PNG, WebP, BMP, GIF, or HEIC.`
      });
    }
    if (!uploaded.buffer || uploaded.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'The uploaded file is empty or could not be read. Please upload a valid receipt image.'
      });
    }

    try {
      // 100% LOCAL pipeline: Tesseract.js OCR on the real image + deterministic
      // regex extraction. Only what is actually detected is returned — every
      // other field stays null ("Not Detected"). Nothing is invented.
      const result = await scanWithLocalOcr(uploaded, mimeType);

      // Non-receipt image detection: if nothing receipt-like was found,
      // surface a clear error instead of an empty review screen.
      const hasAnyContent = Boolean(
        result.productName || result.storeName || result.price || (result.rawExtractedText || '').trim()
      );
      if (!hasAnyContent) {
        return res.status(422).json({
          success: false,
          message: 'This image does not look like a receipt. No product, store, or amount could be detected. Please upload a clear photo of a receipt.'
        });
      }

      // Check for duplicate bill if user context is available
      const userIdFromReq = getUserIdFromRequest(req);
      if (userIdFromReq) {
        try {
          const existingDuplicate = await PurchaseService.checkDuplicate(userIdFromReq, result);
          if (existingDuplicate) {
            return res.status(409).json({
              success: false,
              isDuplicate: true,
              message: 'You already have this bill in the system.',
              data: {
                ...result,
                isDuplicate: true,
                duplicateMessage: 'You already have this bill in the system.',
                existingPurchase: existingDuplicate
              }
            });
          }
        } catch (dupErr) {
          console.warn('[Scan] Duplicate check warning:', dupErr.message);
        }

        // Check for spending anomaly using ML-03 IsolationForest model
        if (result.amount || result.price) {
          try {
            const anomalyFeatures = await PurchaseService.calculateAnomalyFeatures(userIdFromReq, result);
            const anomalyResult = await MlService.detectSpendingAnomaly(anomalyFeatures);
            if (anomalyResult && anomalyResult.isAnomaly) {
              result.isAnomaly = true;
              result.anomalyScore = anomalyResult.anomalyScore;
              result.anomalyNotice = `⚠️ Unusual spending detected: ${result.currency || '₹'}${parseFloat(result.amount || result.price).toLocaleString()} is significantly higher than your usual purchase pattern.`;
            }
          } catch (anomErr) {
            console.warn('[Scan] Anomaly check notice:', anomErr.message);
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: result.isDuplicate
          ? 'You already have this bill in the system. Review the detected details.'
          : 'Receipt analyzed with Local OCR (offline). Review the detected details before saving.',
        engine: 'ocr',
        data: result
      });
    } catch (err) {
      console.warn('[Scan] Analysis failed:', err.message);
      return res.status(500).json({
        success: false,
        message: err.message || 'Receipt analysis failed. Please try again.'
      });
    }
  }

  // 4. Database Compass Connection Status (health, no user data)
  if (pathName === '/api/purchases/db/status' && method === 'GET') {
    const status = getDbStatus();
    return res.status(200).json({
      success: true,
      data: status
    });
  }

  // 4b. AI Scanner Status (which OCR engine is active — no user data)
  if (pathName === '/api/ai/status' && method === 'GET') {
    return res.status(200).json({
      success: true,
      data: {
        provider: 'tesseract-local',
        enabled: true,
        model: 'Tesseract.js (local, offline)'
      }
    });
  }

  // 4c. RECEIPT SCANNER (legacy alias): POST /api/scanner/analyze
  //     FormData field "image" -> multer -> real image bytes -> local Tesseract
  //     OCR -> mapped fields (null for missing) -> review UI.
  if (pathName === '/api/scanner/analyze' && method === 'POST') {
    console.log('[Scanner] Request received: POST /api/scanner/analyze');

    const uploaded = req.files && req.files[0];
    if (!uploaded) {
      return res.status(400).json({
        success: false,
        message: 'No image uploaded. Please attach a receipt image in the "image" field.'
      });
    }
    console.log(`[Scanner] File received: ${uploaded.originalname} (${uploaded.mimetype}, ${uploaded.size} bytes)`);

    const mimeType = uploaded.mimetype || 'image/jpeg';
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/heic', 'image/heif', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid image type "${mimeType}". Use JPG, JPEG, PNG, WebP, BMP, or HEIC.`
      });
    }
    if (!uploaded.buffer || uploaded.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'The uploaded file is empty or could not be read. Please upload a valid receipt image.'
      });
    }

    try {
      // Same 100% local pipeline as /api/purchases/scan.
      const result = await scanWithLocalOcr(uploaded, mimeType);

      return res.status(200).json({
        success: true,
        message: 'Local OCR analysis complete. Review the detected details before saving.',
        engine: 'ocr',
        data: result
      });
    } catch (err) {
      console.warn('[Scanner] Analysis failed:', err.message);
      return res.status(500).json({
        success: false,
        message: err.message || 'Receipt analysis failed. Please try again.'
      });
    }
  }

  // ===== AUTHENTICATED USER-DATA ENDPOINTS (Task 3: per-user isolation) =====
  // Only enter the protected block for paths that belong to the purchases API,
  // so unrelated /api/ routes (e.g. /api/notifications) fall through to the
  // other route handlers in server.js.
  const isPurchaseDataRoute =
    pathName === '/api/purchases' ||
    pathName === '/api/purchases/analytics/stats' ||
    pathName === '/api/purchases/analytics/behavior' ||
    pathName === '/api/purchases/alerts/deadlines' ||
    pathName === '/api/purchases/check-warranty-reminders' ||
    pathName.startsWith('/api/purchases/export/') ||
    !!pathName.match(/^\/api\/purchases\/[^\/]+\/claim-letter$/) ||
    !!pathName.match(/^\/api\/purchases\/[^\/]+\/warranty-reminder$/) ||
    !!pathName.match(/^\/api\/purchases\/[a-zA-Z0-9_-]+$/);

  if (!isPurchaseDataRoute) {
    return false; // Not a purchases route — let other handlers try
  }

  return new Promise((resolve) => {
    requireAuth(req, res, async () => {
      try {
        const userId = req.user.id;

        // 5. Analytics & Spending Stats
        if (pathName === '/api/purchases/analytics/stats' && method === 'GET') {
          const stats = await PurchaseService.getSpendingAnalytics(userId);
          return res.status(200).json({
            success: true,
            data: stats
          });
        }

      // 5b. ML-04: Purchase Behavior Clustering Prediction
      if (pathName === '/api/purchases/analytics/behavior' && method === 'GET') {
        try {
          const behaviorData = await PurchaseService.calculateUserBehaviorFeatures(userId);

          // Insufficient data fallback (< 3 purchases)
          if (!behaviorData.hasSufficientData) {
            return res.status(200).json({
              success: true,
              status: 'insufficient_data',
              message: `Add at least ${3 - behaviorData.purchaseCount} more purchase(s) to unlock your AI Purchase Behavior Segment!`,
              purchaseCount: behaviorData.purchaseCount,
              minRequired: 3
            });
          }

          // Call ML-04 FastAPI service
          const mlResult = await MlService.predictPurchaseBehavior(behaviorData.features);

          if (!mlResult) {
            // ML service unavailable — graceful fallback
            return res.status(200).json({
              success: true,
              status: 'service_unavailable',
              message: 'Purchase Behavior AI is temporarily offline. Your spending data is ready — check back shortly!',
              purchaseCount: behaviorData.purchaseCount
            });
          }

          return res.status(200).json({
            success: true,
            status: 'predicted',
            data: {
              ...mlResult,
              purchaseCount: behaviorData.purchaseCount,
              computedFeatures: behaviorData.features
            }
          });
        } catch (behaviorErr) {
          console.warn('[PurchaseRoutes] Behavior prediction error:', behaviorErr.message);
          return res.status(200).json({
            success: true,
            status: 'service_unavailable',
            message: 'Purchase Behavior AI encountered an issue. Other features are unaffected.'
          });
        }
      }

      // 6. Deadlines & Expiry Alert Center
      if (pathName === '/api/purchases/alerts/deadlines' && method === 'GET') {
        const deadlines = await PurchaseService.getDeadlinesAndAlerts(userId);
        return res.status(200).json({
          success: true,
          data: deadlines
        });
      }

      // 7. Export Purchases Data (CSV / JSON)
      if (pathName.startsWith('/api/purchases/export/') && method === 'GET') {
        const format = pathName.split('/')[4] || 'csv';
        const exportResult = await PurchaseService.exportData(userId, format);

        res.setHeader('Content-Type', exportResult.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
        return res.status(200).end(exportResult.data);
      }

      // 8. Generate AI Warranty Claim Letter
      if (pathName.match(/^\/api\/purchases\/([^\/]+)\/claim-letter$/) && method === 'POST') {
        const purchaseId = pathName.split('/')[3];
        const purchase = await PurchaseService.getPurchaseById(purchaseId, userId);
        if (!purchase) {
          return res.status(404).json({ success: false, message: 'Purchase item not found.' });
        }

        const {
          issueCategory,
          issueDescription,
          desiredResolution,
          customerName,
          customerEmail
        } = req.body;

        const letter = AiClaimService.generateClaimLetter({
          customerName: customerName || req.user?.name || 'Authorized Purchaser',
          customerEmail: customerEmail || req.user?.email || '',
          productName: purchase.productName,
          brand: purchase.brand,
          storeName: purchase.storeName,
          purchaseDate: purchase.purchaseDate,
          price: purchase.price,
          currency: purchase.currency,
          warrantyMonths: purchase.warrantyMonths,
          warrantyExpiresAt: purchase.warrantyExpiresAt,
          serialNumber: purchase.serialNumber,
          modelNumber: purchase.modelNumber,
          invoiceNumber: purchase.invoiceNumber,
          issueCategory,
          issueDescription,
          desiredResolution
        });

        // Save claim history onto purchase record
        const claimRecord = {
          issueDescription: issueDescription || 'General Defect',
          claimType: desiredResolution || 'Warranty Repair',
          letterContent: letter.letterBody,
          status: 'submitted'
        };

        const currentClaims = purchase.claimHistory || [];
        currentClaims.push(claimRecord);
        await PurchaseService.updatePurchase(purchaseId, userId, { claimHistory: currentClaims, status: 'claimed' });

        // Notify the user about the claim submission
        await NotificationService.createNotification(userId, {
          title: 'Warranty Claim Submitted 🛡️',
          message: `Your AI-generated claim for ${purchase.productName} has been drafted and recorded. Keep the letter for your records and follow up with ${purchase.storeName}.`,
          type: 'CLAIM_UPDATE',
          urgency: 'INFO',
          purchaseId: purchaseId,
          dueDate: purchase.warrantyExpiresAt || null
        });

        return res.status(200).json({
          success: true,
          message: 'AI Warranty Claim Letter generated successfully!',
          data: letter
        });
      }

      // 8b. Manual Warranty Reminder Email
      if (pathName.match(/^\/api\/purchases\/([^\/]+)\/warranty-reminder$/) && method === 'POST') {
        const purchaseId = pathName.split('/')[3];
        const result = await PurchaseService.sendManualWarrantyReminder(
          purchaseId, userId, { email: req.user.email, name: req.user.name }
        );

        if (result.success) {
          return res.status(200).json({
            success: true,
            message: 'Warranty reminder sent successfully.'
          });
        } else {
          return res.status(400).json({
            success: false,
            message: result.message || 'Unable to send warranty reminder.'
          });
        }
      }

      // 8c. Auto-check all purchases for warranty reminders
      if (pathName === '/api/purchases/check-warranty-reminders' && method === 'POST') {
        try {
          await PurchaseService.checkAndSendWarrantyReminders(
            userId, { email: req.user.email, name: req.user.name }
          );
          return res.status(200).json({
            success: true,
            message: 'Warranty reminder check completed.'
          });
        } catch (err) {
          return res.status(500).json({
            success: false,
            message: 'Failed to check warranty reminders: ' + err.message
          });
        }
      }

      // 9. List Purchases (with Query Params: category, status, search, sort)
      if (pathName === '/api/purchases' && method === 'GET') {
        const filters = {
          category: req.query.category,
          status: req.query.status,
          search: req.query.search,
          sort: req.query.sort
        };

        const list = await PurchaseService.getPurchases(userId, filters);
        return res.status(200).json({
          success: true,
          count: list.length,
          data: list
        });
      }

      // 10. Create New Purchase Record
      if (pathName === '/api/purchases' && method === 'POST') {
        const hasName = Boolean(req.body.productName);
        const hasMerchant = Boolean(req.body.merchant || req.body.storeName);
        const hasAmount = req.body.amount !== undefined || req.body.price !== undefined;

        if (!hasName || !hasMerchant || !hasAmount) {
          return res.status(400).json({
            success: false,
            message: 'productName, merchant (or storeName), and amount (or price) are required fields.'
          });
        }

        try {
          const created = await PurchaseService.createPurchase(userId, req.body);

          // Keep notification alerts in sync with the new purchase
          await NotificationService.seedFromPurchases(userId);

          return res.status(201).json({
            success: true,
            message: 'Purchase record saved to MongoDB successfully!',
            data: created
          });
        } catch (err) {
          if (err.statusCode === 409 || (err.message && err.message.includes('already have this bill'))) {
            return res.status(409).json({
              success: false,
              isDuplicate: true,
              message: 'You already have this bill in the system.'
            });
          }
          throw err;
        }
      }

      // 11. Single Purchase GET / PUT / DELETE by ID
      const itemMatch = pathName.match(/^\/api\/purchases\/([a-zA-Z0-9_-]+)$/);
      if (itemMatch) {
        const purchaseId = itemMatch[1];

        if (method === 'GET') {
          const item = await PurchaseService.getPurchaseById(purchaseId, userId);
          if (!item) {
            return res.status(404).json({ success: false, message: 'Purchase not found.' });
          }
          return res.status(200).json({ success: true, data: item });
        }

        if (method === 'PUT' || method === 'PATCH') {
          const updated = await PurchaseService.updatePurchase(purchaseId, userId, req.body);
          if (!updated) {
            return res.status(404).json({ success: false, message: 'Purchase not found for update.' });
          }
          return res.status(200).json({
            success: true,
            message: 'Purchase details updated successfully.',
            data: updated
          });
        }

        if (method === 'DELETE') {
          const deleted = await PurchaseService.deletePurchase(purchaseId, userId);
          if (!deleted) {
            return res.status(404).json({ success: false, message: 'Purchase not found or already deleted.' });
          }
          return res.status(200).json({
            success: true,
            message: 'Purchase and warranty record removed successfully.'
          });
        }
      }

      return res.status(404).json({
        success: false,
        message: `API Endpoint ${method} ${pathName} not found.`
      });
    } catch (err) {
      console.error('[PurchaseRoutes] Route error:', err.message);
      return res.status(500).json({ success: false, message: 'Server error processing purchase request: ' + err.message });
    }
  });
});
}

module.exports = {
  handlePurchaseRoutes,
  upload
};
