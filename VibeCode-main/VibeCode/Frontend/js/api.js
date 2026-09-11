/**
 * Centralized API Service Layer — WarrantyVault AI Starter Architecture
 * Automatically detects server origin (port 5000) or falls back to localhost:5000.
 */
const API_BASE_URL = window.location.origin && window.location.origin.startsWith('http')
  ? `${window.location.origin}/api`
  : 'http://localhost:5000/api';

class ApiService {
  /**
   * Helper request wrapper
   */
  static async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

    const defaultHeaders = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    // Include token from localStorage if available
    const token = localStorage.getItem('vibecode_token');
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    // Include session user ID header if present
    try {
      const session = JSON.parse(localStorage.getItem('userSession') || '{}');
      if (session && session.id) {
        defaultHeaders['X-User-Id'] = session.id;
      }
    } catch(e) {}

    const config = {
      method: options.method || 'GET',
      headers: {
        ...defaultHeaders,
        ...options.headers
      },
      credentials: 'include', // Ensure HTTP-only cookies are sent & received
      ...options
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({
        success: false,
        message: 'Unable to parse server response.'
      }));

      if (!response.ok) {
        const error = new Error(data.message || `HTTP Error ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      if (!err.status) {
        err.message = 'Network error or server unreachable. Please check your connection.';
      }
      throw err;
    }
  }

  // HTTP Method Shortcuts
  static get(endpoint, headers = {}) {
    return ApiService.request(endpoint, { method: 'GET', headers });
  }

  static post(endpoint, body = {}, headers = {}) {
    return ApiService.request(endpoint, { method: 'POST', body, headers });
  }

  static put(endpoint, body = {}, headers = {}) {
    return ApiService.request(endpoint, { method: 'PUT', body, headers });
  }

  static patch(endpoint, body = {}, headers = {}) {
    return ApiService.request(endpoint, { method: 'PATCH', body, headers });
  }

  static delete(endpoint, headers = {}) {
    return ApiService.request(endpoint, { method: 'DELETE', headers });
  }
}

/**
 * Dedicated Purchase & Warranty Management API Client
 */
class PurchaseApi {
  // Get sample receipts for competition demo
  static getSamples() {
    return ApiService.get('/purchases/samples');
  }

  // 1-Click Scan sample receipt
  static scanSample(sampleId) {
    return ApiService.post('/purchases/sample-scan', { sampleId });
  }

  // Scan uploaded receipt or raw OCR text
  static scanReceipt(payload) {
    return ApiService.post('/purchases/scan', payload);
  }

  // Scan an ACTUAL receipt image file via FormData (field "receipt").
  // Backend pipeline: multer -> sharp preprocessing -> OCR -> Gemini -> strict JSON.
  static scanReceiptFile(file) {
    const formData = new FormData();
    formData.append('receipt', file);
    return ApiService.request('/purchases/scan', {
      method: 'POST',
      body: formData,
      headers: {} // let fetch set the multipart boundary
    });
  }

  // List purchases with optional filters { category, status, search, sort }
  static getPurchases(filters = {}) {
    const params = new URLSearchParams();
    if (filters.category && filters.category !== 'all') params.append('category', filters.category);
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.search) params.append('search', filters.search);
    if (filters.sort) params.append('sort', filters.sort);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    return ApiService.get(`/purchases${query}`);
  }

  // Get single purchase by ID
  static getPurchase(id) {
    return ApiService.get(`/purchases/${id}`);
  }

  // Create new purchase
  static createPurchase(data) {
    return ApiService.post('/purchases', data);
  }

  // Update purchase
  static updatePurchase(id, data) {
    return ApiService.put(`/purchases/${id}`, data);
  }

  // Delete purchase
  static deletePurchase(id) {
    return ApiService.delete(`/purchases/${id}`);
  }

  // Spending analytics & metrics
  static getStats() {
    return ApiService.get('/purchases/analytics/stats');
  }

  // ML-04 Purchase Behavior Clustering prediction & segments
  static getBehavior() {
    return ApiService.get('/purchases/analytics/behavior');
  }

  // Upcoming return deadlines & warranty expiration alerts
  static getDeadlines() {
    return ApiService.get('/purchases/alerts/deadlines');
  }

  // Generate 1-Click AI Warranty Claim Letter
  static generateClaimLetter(purchaseId, claimDetails) {
    return ApiService.post(`/purchases/${purchaseId}/claim-letter`, claimDetails);
  }

  // Get export URL for CSV or JSON
  static getExportUrl(format = 'csv') {
    return `${API_BASE_URL}/purchases/export/${format}`;
  }

  // Get live DB / Compass status
  static getDbStatus() {
    return ApiService.get('/purchases/db/status');
  }

  // Send a manual warranty reminder email for a specific purchase
  static sendWarrantyReminder(purchaseId) {
    return ApiService.post(`/purchases/${purchaseId}/warranty-reminder`);
  }

  // Auto-check all purchases for approaching warranty deadlines and send reminders
  static checkWarrantyReminders() {
    return ApiService.post('/purchases/check-warranty-reminders');
  }
}

/**
 * Dedicated Notification Center API Client (per-user, auth-required)
 */
class NotificationApi {
  // List all notifications for the current user
  static getNotifications() {
    return ApiService.get('/notifications');
  }

  // Unread notification count
  static getUnreadCount() {
    return ApiService.get('/notifications/unread-count');
  }

  // Refresh notifications from live purchase deadlines & warranty alerts
  static seedNotifications() {
    return ApiService.post('/notifications/seed');
  }

  // Mark a single notification as read
  static markAsRead(id) {
    return ApiService.post(`/notifications/${id}/read`);
  }

  // Mark all notifications as read
  static markAllAsRead() {
    return ApiService.post('/notifications/read-all');
  }
}

/**
 * AI Warranty Claim Center API Client (Task 6 — per-user, auth-required)
 */
class ClaimApi {
  // List all claims for the current user
  static getClaims() {
    return ApiService.get('/claims');
  }

  // Get a single claim
  static getClaim(id) {
    return ApiService.get(`/claims/${id}`);
  }

  // File a new AI warranty claim against a purchase
  static createClaim(details) {
    return ApiService.post('/claims', details);
  }

  // Update claim status (submitted / in_review / approved / rejected)
  static updateClaimStatus(id, status, resolutionNote = '') {
    return ApiService.patch(`/claims/${id}`, { status, resolutionNote });
  }

  // Delete a claim
  static deleteClaim(id) {
    return ApiService.delete(`/claims/${id}`);
  }
}

/**
 * AI Purchase Copilot API Client (Task 7 — per-user, auth-required)
 */
class CopilotApi {
  // Ask the copilot a question (answers from real vault data + saves history)
  static chat(message, sessionId = null) {
    return ApiService.post('/copilot/chat', { message, sessionId });
  }

  // Get data-driven suggestions + vault summary (for chat welcome & chips)
  static getSuggestions() {
    return ApiService.get('/copilot/suggestions');
  }

  // List chat sessions
  static getHistory() {
    return ApiService.get('/copilot/history');
  }

  // Get messages of one session
  static getSession(sessionId) {
    return ApiService.get(`/copilot/history/${sessionId}`);
  }

  // Clear a session
  static clearSession(sessionId) {
    return ApiService.delete(`/copilot/history/${sessionId}`);
  }
}

/**
 * Documents & Receipts API Client (Task 8 — per-user, auth-required)
 */
class DocumentApi {
  // Upload a receipt/document file (FormData with field "file")
  static upload(file, purchaseId = null, ocrText = '', summary = null) {
    const formData = new FormData();
    formData.append('file', file);
    if (purchaseId) formData.append('purchaseId', purchaseId);
    if (ocrText) formData.append('ocrText', ocrText);
    if (summary) formData.append('summary', summary);
    return ApiService.request('/documents/upload', {
      method: 'POST',
      body: formData,
      headers: {} // let fetch set the multipart boundary
    });
  }

  // List all documents
  static getDocuments() {
    return ApiService.get('/documents');
  }

  // Get a single document
  static getDocument(id) {
    return ApiService.get(`/documents/${id}`);
  }

  // Translate document summary into target language
  static translateDocument(id, language) {
    return ApiService.post(`/documents/${id}/translate`, { language });
  }

  // Get synthesized speech audio Blob (supports all languages including Marathi)
  static async getTtsAudioBlob(text, language = 'mr') {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/documents/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ text, language })
    });
    if (!response.ok) {
      throw new Error(`TTS failed with HTTP ${response.status}`);
    }
    return await response.blob();
  }

  // Delete a document (+ its file)
  static deleteDocument(id) {
    return ApiService.delete(`/documents/${id}`);
  }
}

/**
 * RAG Chatbot API Client (User-isolated RAG Knowledge Assistant — /api/chat)
 */
class ChatApi {
  // Ask the RAG chatbot a question (user-isolated retrieval + grounded Gemini response)
  static chat(message, sessionId = null) {
    return ApiService.post('/chat', { message, sessionId });
  }

  // List RAG chat sessions
  static getSessions() {
    return ApiService.get('/chat/sessions');
  }

  // Get messages of a specific session
  static getSession(sessionId) {
    return ApiService.get(`/chat/sessions/${sessionId}`);
  }

  // Delete a session
  static deleteSession(sessionId) {
    return ApiService.delete(`/chat/sessions/${sessionId}`);
  }

  // Re-index all purchases for current user
  static rebuildIndex() {
    return ApiService.post('/chat/rebuild', {});
  }
}

// Global scope export for vanilla JS scripts
window.ApiService = ApiService;
window.PurchaseApi = PurchaseApi;
window.NotificationApi = NotificationApi;
window.ClaimApi = ClaimApi;
window.CopilotApi = CopilotApi;
window.DocumentApi = DocumentApi;
window.ChatApi = ChatApi;

/**
 * Currency display helpers.
 * Defaults to Indian Rupee (INR) — change via Profile → Preferences.
 */
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  AED: 'د.إ'
};

function getPreferredCurrency() {
  return localStorage.getItem('currency') || 'INR';
}

function getCurrencySymbol(currency) {
  const c = currency || getPreferredCurrency();
  return CURRENCY_SYMBOLS[c] || '₹';
}

window.CURRENCY_SYMBOLS = CURRENCY_SYMBOLS;
window.getPreferredCurrency = getPreferredCurrency;
window.getCurrencySymbol = getCurrencySymbol;
