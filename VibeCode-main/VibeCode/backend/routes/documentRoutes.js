const path = require('path');
const fs = require('fs');
const DocumentService = require('../services/documentService');
const TranslationService = require('../services/translationService');
const { requireAuth } = require('../middleware/authMiddleware');

// Ensure receipt uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'receipts');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Write an uploaded file (parsed into memory by server.js multer) to disk
 * and return a multer-compatible file object for DocumentService.
 */
function persistUploadedFile(file) {
  const ext = path.extname(file.originalname || '');
  const filename = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`;
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, file.buffer);
  return {
    filename,
    originalname: file.originalname || filename,
    mimetype: file.mimetype || 'application/octet-stream',
    size: file.size || file.buffer.length
  };
}

/**
 * Documents & Receipts API Routes — Task 8.
 * Every endpoint requires authentication and is strictly scoped to the
 * authenticated user (Task 3 data isolation).
 */
async function handleDocumentRoutes(req, res, pathName, method) {
  const isDocumentRoute =
    pathName === '/api/documents' ||
    pathName === '/api/documents/upload' ||
    pathName === '/api/documents/tts' ||
    !!pathName.match(/^\/api\/documents\/[a-zA-Z0-9_-]+\/translate$/) ||
    !!pathName.match(/^\/api\/documents\/[a-zA-Z0-9_-]+$/);

  if (!isDocumentRoute) {
    return false; // Not a documents route — let other handlers try
  }

  return new Promise((resolve) => {
    requireAuth(req, res, async () => {
      const userId = req.user.id;

      // 1. UPLOAD: POST /api/documents/upload (multipart/form-data, field "file")
      if (pathName === '/api/documents/upload' && method === 'POST') {
        const uploaded = req.files && req.files[0];
        if (!uploaded) {
          return res.status(400).json({ success: false, message: 'No file uploaded. Use a multipart field named "file".' });
        }
        if (uploaded.size > 15 * 1024 * 1024) {
          return res.status(400).json({ success: false, message: 'File is too large. Maximum size is 15 MB.' });
        }

        const file = persistUploadedFile(uploaded);
        const { purchaseId, ocrText, summary } = req.body;
        try {
          const doc = await DocumentService.saveUpload(userId, file, {
            purchaseId: purchaseId || null,
            ocrText: ocrText || '',
            summary: summary || null
          });
          return res.status(201).json({
            success: true,
            message: 'Document uploaded and saved to MongoDB successfully!',
            data: doc
          });
        } catch (saveErr) {
          return res.status(500).json({ success: false, message: 'File saved but could not be recorded. Please try again.' });
        }
      }

      // 2. LIST: GET /api/documents
      if (pathName === '/api/documents' && method === 'GET') {
        try {
          const docs = await DocumentService.listDocuments(userId);
          return res.status(200).json({
            success: true,
            count: docs.length,
            data: docs
          });
        } catch (err) {
          return res.status(500).json({ success: false, message: 'Failed to load documents.' });
        }
      }

      // 3. Translate: POST /api/documents/:id/translate
      const transMatch = pathName.match(/^\/api\/documents\/([a-zA-Z0-9_-]+)\/translate$/);
      if (transMatch && method === 'POST') {
        const documentId = transMatch[1];
        const { language } = req.body || {};
        try {
          const result = await DocumentService.translateDocumentSummary(userId, documentId, language);
          return res.status(200).json(result);
        } catch (err) {
          return res.status(err.status || 500).json({
            success: false,
            message: err.message || 'Translation unavailable. Please try again.'
          });
        }
      }

      // 4. TTS Audio Stream: POST or GET /api/documents/tts
      if (pathName === '/api/documents/tts') {
        const text = (req.body && req.body.text) || (req.query && req.query.text);
        const language = (req.body && req.body.language) || (req.query && req.query.language) || 'mr';
        if (!text) {
          return res.status(400).json({ success: false, message: 'Text is required for TTS synthesis.' });
        }
        try {
          const audioBuf = await TranslationService.synthesizeSpeechAudio(text, language);
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuf.length,
            'Cache-Control': 'public, max-age=86400'
          });
          return res.end(audioBuf);
        } catch (err) {
          return res.status(500).json({
            success: false,
            message: err.message || 'TTS audio generation failed.'
          });
        }
      }

      // 4. Single document: GET / DELETE
      const docMatch = pathName.match(/^\/api\/documents\/([a-zA-Z0-9_-]+)$/);
      if (docMatch) {
        const documentId = docMatch[1];

        if (method === 'GET') {
          try {
            const doc = await DocumentService.getDocument(userId, documentId);
            if (!doc) {
              return res.status(404).json({ success: false, message: 'Document not found.' });
            }
            return res.status(200).json({ success: true, data: doc });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to load document.' });
          }
        }

        if (method === 'DELETE') {
          try {
            const deleted = await DocumentService.deleteDocument(userId, documentId);
            if (!deleted) {
              return res.status(404).json({ success: false, message: 'Document not found or already deleted.' });
            }
            return res.status(200).json({ success: true, message: 'Document and file removed successfully.' });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to delete document.' });
          }
        }
      }

      return res.status(404).json({
        success: false,
        message: `API Endpoint ${method} ${pathName} not found.`
      });
    });
  });
}

module.exports = { handleDocumentRoutes };
