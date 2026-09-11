const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Receipt = require('../models/Receipt');
const PurchaseService = require('./purchaseService');

// Resilient in-memory fallback store
const inMemoryReceipts = new Map();
let memorySeq = 0;

function memId() {
  memorySeq += 1;
  return `doc_${Date.now()}_${memorySeq}_${Math.random().toString(36).substr(2, 5)}`;
}

function toSerializable(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = (obj._id && obj._id.toString) ? obj._id.toString() : obj._id;
  return obj;
}

function toObjectIdOrNull(id) {
  if (!id) return null;
  const str = String(id);
  if (mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str) {
    return new mongoose.Types.ObjectId(str);
  }
  return null;
}

const ReceiptSummaryService = require('./receiptSummaryService');
const AiReceiptParser = require('./aiReceiptParser');

class DocumentService {
  /**
   * Save an uploaded receipt file as a Document in MongoDB.
   * file is the multer file object (already written to uploads/receipts).
   */
  static async saveUpload(userId, file, { purchaseId = null, ocrText = '', summary = null } = {}) {
    const normalizedPurchaseId = toObjectIdOrNull(purchaseId);
    const fileUrl = `/uploads/receipts/${file.filename}`;
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimeType = file.mimetype || 'image/jpeg';

    let finalSummary = summary || null;
    let finalOcrText = ocrText || '';

    if (!finalSummary && normalizedPurchaseId) {
      try {
        const linkedPurchase = await PurchaseService.getPurchaseById(String(normalizedPurchaseId), userId);
        if (linkedPurchase) {
          finalSummary = linkedPurchase.summary || (await ReceiptSummaryService.generateSummary(linkedPurchase));
        }
      } catch (e) {}
    }

    if (!finalSummary) {
      try {
        if (!finalOcrText && mimeType.startsWith('image/')) {
          const filePath = path.join(__dirname, '..', 'uploads', 'receipts', file.filename);
          if (fs.existsSync(filePath)) {
            const Tesseract = require('tesseract.js');
            const fileBuf = fs.readFileSync(filePath);
            const { data } = await Tesseract.recognize(fileBuf, 'eng', { logger: () => {} });
            finalOcrText = (data && data.text ? data.text : '').trim();
          }
        }

        const parsed = AiReceiptParser.parseReceiptText(finalOcrText || '', file.originalname || file.filename);
        if (parsed && (parsed.productName || parsed.storeName || parsed.price || (parsed.items && parsed.items.length > 0))) {
          finalSummary = ReceiptSummaryService.generateDeterministicSummary({
            productName: parsed.productName,
            brand: parsed.brand,
            merchant: parsed.storeName,
            amount: parsed.price,
            currency: parsed.currency || 'INR',
            purchaseDate: parsed.purchaseDate,
            warrantyMonths: parsed.warrantyMonths,
            returnPeriodDays: parsed.returnPeriodDays,
            paymentMethod: parsed.paymentMethod,
            category: parsed.category,
            invoiceNumber: parsed.invoiceNumber || parsed.orderId,
            items: parsed.items,
            discount: parsed.discount,
            tax: parsed.tax
          });
        }
      } catch (genErr) {
        console.warn('[DocumentService] Upload summary extraction notice:', genErr.message);
      }
    }

    const payload = {
      userId,
      purchaseId: normalizedPurchaseId,
      originalFileName: file.originalname || file.filename,
      fileUrl,
      fileSize: file.size || 0,
      mimeType,
      ocrExtractedText: finalOcrText,
      summary: finalSummary,
      uploadedAt: new Date()
    };

    if (mongoose.connection.readyState === 1) {
      try {
        const doc = new Receipt(payload);
        const saved = await doc.save();
        const serialized = toSerializable(saved);
        inMemoryReceipts.set(serialized.id, serialized);
        return serialized;
      } catch (err) {
        console.warn('Receipt MongoDB save warning, using memory fallback:', err.message);
      }
    }

    const id = memId();
    const record = { id, _id: id, ...payload, createdAt: new Date(), updatedAt: new Date() };
    inMemoryReceipts.set(id, record);
    return record;
  }

  /**
   * List documents for a user, enriched with linked purchase product name and summary.
   * Seamlessly resolves, OCRs, and backfills summaries for existing documents.
   */
  static async listDocuments(userId) {
    let docs = [];

    if (mongoose.connection.readyState === 1) {
      try {
        const found = await Receipt.find({ userId }).sort({ uploadedAt: -1 });
        docs = found.map(toSerializable);
      } catch (err) {
        console.warn('Receipt query warning, using memory fallback:', err.message);
      }
    }

    if (docs.length === 0) {
      docs = Array.from(inMemoryReceipts.values())
        .filter(d => d.userId === userId)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    }

    // Enrich with linked purchase info (product name, store, summary)
    const purchases = await PurchaseService.getPurchases(userId).catch(() => []);
    const purchaseMap = new Map(purchases.map(p => [String(p.id), p]));

    const enrichedDocs = await Promise.all(docs.map(async d => {
      // 1. Resolve linked purchase by ID or filename/URL matching
      let linked = d.purchaseId ? purchaseMap.get(String(d.purchaseId)) : null;
      if (!linked && purchases.length > 0) {
        linked = purchases.find(p =>
          (p.receiptFileName && p.receiptFileName === d.originalFileName) ||
          (p.receiptReference && p.receiptReference === d.originalFileName) ||
          (p.receiptImageUrl && p.receiptImageUrl === d.fileUrl)
        ) || null;
      }

      // 2. Resolve or generate summary
      let docSummary = d.summary || (linked ? linked.summary : null);
      const isGeneric = !docSummary ||
        docSummary.includes('Receipt document recorded') ||
        docSummary.includes('Receipt recorded in vault') ||
        !docSummary.includes('•');

      if (isGeneric) {
        if (linked) {
          docSummary = ReceiptSummaryService.generateDeterministicSummary(linked);
          if (!linked.summary && linked.id) {
            PurchaseService.updatePurchase(linked.id, userId, { summary: docSummary }).catch(() => {});
          }
        } else {
          // If OCR text is missing, attempt on-demand OCR from disk
          let ocrText = d.ocrExtractedText || '';
          if (!ocrText && d.fileUrl) {
            try {
              const fullPath = path.join(__dirname, '..', d.fileUrl);
              if (fs.existsSync(fullPath)) {
                const Tesseract = require('tesseract.js');
                const fileBuf = fs.readFileSync(fullPath);
                const { data } = await Tesseract.recognize(fileBuf, 'eng', { logger: () => {} });
                ocrText = (data && data.text ? data.text : '').trim();
                d.ocrExtractedText = ocrText;
              }
            } catch (ocrErr) {
              console.warn('[DocumentService] On-demand OCR notice:', ocrErr.message);
            }
          }

          if (ocrText || d.originalFileName) {
            const parsed = AiReceiptParser.parseReceiptText(ocrText || '', d.originalFileName);
            if (parsed && (parsed.productName || parsed.storeName || parsed.price || (parsed.items && parsed.items.length > 0))) {
              docSummary = ReceiptSummaryService.generateDeterministicSummary({
                productName: parsed.productName,
                brand: parsed.brand,
                merchant: parsed.storeName,
                amount: parsed.price,
                currency: parsed.currency || 'INR',
                purchaseDate: parsed.purchaseDate || d.uploadedAt,
                warrantyMonths: parsed.warrantyMonths,
                returnPeriodDays: parsed.returnPeriodDays,
                paymentMethod: parsed.paymentMethod,
                category: parsed.category,
                invoiceNumber: parsed.invoiceNumber || parsed.orderId,
                items: parsed.items,
                discount: parsed.discount,
                tax: parsed.tax
              });
            } else {
              const cleanName = (d.originalFileName || 'Receipt')
                .replace(/\.[^/.]+$/, '')
                .replace(/[-_]/g, ' ')
                .trim();
              docSummary = ReceiptSummaryService.generateDeterministicSummary({
                productName: cleanName,
                purchaseDate: d.uploadedAt
              });
            }
          }
        }

        // Asynchronously persist generated summary and OCR text to MongoDB Receipt
        if (docSummary && d.id) {
          if (mongoose.connection.readyState === 1) {
            Receipt.updateOne(
              { _id: d._id || d.id, userId },
              { $set: { summary: docSummary, ocrExtractedText: d.ocrExtractedText || '', purchaseId: linked ? (linked._id || linked.id) : d.purchaseId } }
            ).catch(() => {});
          }
          if (inMemoryReceipts.has(d.id)) {
            const mem = inMemoryReceipts.get(d.id);
            mem.summary = docSummary;
            mem.ocrExtractedText = d.ocrExtractedText || '';
            if (linked) mem.purchaseId = linked.id || linked._id;
          }
        }
      }

      return {
        ...d,
        summary: docSummary,
        productName: linked ? linked.productName : null,
        storeName: linked ? (linked.storeName || linked.merchant) : null,
        linkedPurchase: linked ? {
          id: linked.id,
          productName: linked.productName,
          storeName: linked.storeName || linked.merchant,
          amount: linked.amount !== undefined ? linked.amount : linked.price,
          currency: linked.currency,
          summary: docSummary
        } : null
      };
    }));

    return enrichedDocs;
  }

  /**
   * Get a single document (ownership enforced)
   */
  static async getDocument(userId, id) {
    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await Receipt.findOne({ _id: id, userId });
        if (doc) return toSerializable(doc);
      } catch (err) {}
    }
    const record = inMemoryReceipts.get(id);
    if (record && record.userId === userId) return record;
    return null;
  }

  /**
   * Delete a document record AND its physical file (ownership enforced)
   */
  static async deleteDocument(userId, id) {
    let record = null;

    if (mongoose.connection.readyState === 1) {
      try {
        const doc = await Receipt.findOneAndDelete({ _id: id, userId });
        if (doc) record = toSerializable(doc);
      } catch (err) {}
    }

    if (!record) {
      const mem = inMemoryReceipts.get(id);
      if (mem && mem.userId === userId) {
        record = mem;
        inMemoryReceipts.delete(id);
      }
    }

    if (!record) return false;

    // Remove the physical file if it lives inside the uploads directory
    try {
      const fileUrl = record.fileUrl || '';
      if (fileUrl.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', fileUrl);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      console.warn('Could not remove uploaded file:', err.message);
    }
    return true;
  }

  /**
   * Translate stored receipt summary with MongoDB caching (ownership enforced)
   */
  static async translateDocumentSummary(userId, id, targetLang) {
    const TranslationService = require('./translationService');
    const lang = String(targetLang || 'en').toLowerCase().trim();
    if (!TranslationService.isLanguageSupported(lang)) {
      const err = new Error(`Language "${targetLang}" is not supported.`);
      err.status = 400;
      throw err;
    }

    let doc = null;
    let isMongo = false;

    if (mongoose.connection.readyState === 1) {
      try {
        doc = await Receipt.findOne({ _id: id, userId });
        if (doc) isMongo = true;
      } catch (err) {}
    }

    if (!doc) {
      const mem = inMemoryReceipts.get(id);
      if (mem && mem.userId === userId) {
        doc = mem;
      }
    }

    if (!doc) {
      const err = new Error('Document not found or access denied.');
      err.status = 404;
      throw err;
    }

    const summary = doc.summary;
    if (!summary || !summary.trim()) {
      const err = new Error('Receipt has no summary available to translate.');
      err.status = 400;
      throw err;
    }

    // 1. If English is requested, return original summary
    if (lang === 'en') {
      return {
        success: true,
        receiptId: id,
        language: 'en',
        translation: summary,
        cached: true
      };
    }

    // 2. Check cached translation
    const cachedTranslations = doc.translations || {};
    let existingTranslation = null;
    if (cachedTranslations instanceof Map) {
      existingTranslation = cachedTranslations.get(lang);
    } else if (typeof cachedTranslations === 'object') {
      existingTranslation = cachedTranslations[lang];
    }

    if (existingTranslation && typeof existingTranslation === 'string' && existingTranslation.trim()) {
      return {
        success: true,
        receiptId: id,
        language: lang,
        translation: existingTranslation.trim(),
        cached: true
      };
    }

    // 3. Generate translation via TranslationService
    const translatedText = await TranslationService.translateReceiptSummary(summary, lang);

    // 4. Cache translation in DB
    if (isMongo && doc) {
      try {
        if (!doc.translations) doc.translations = new Map();
        if (doc.translations instanceof Map) {
          doc.translations.set(lang, translatedText);
        } else {
          doc.translations[lang] = translatedText;
        }
        await doc.save();
      } catch (saveErr) {
        console.warn('[DocumentService] Translation cache save warning:', saveErr.message);
      }
    } else if (doc) {
      if (!doc.translations) doc.translations = {};
      doc.translations[lang] = translatedText;
    }

    return {
      success: true,
      receiptId: id,
      language: lang,
      translation: translatedText,
      cached: false
    };
  }
}

module.exports = DocumentService;
