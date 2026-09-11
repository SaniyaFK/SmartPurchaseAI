/**
 * Documents & Receipts — WarrantyVault AI (Task 8)
 * Upload receipt images/PDFs, store them in MongoDB, and link them to purchases.
 */

let allDocuments = [];

document.addEventListener('DOMContentLoaded', async () => {
  const user = await RouteGuard.requireAuth('./index.html');
  if (!user) return;

  initThemeEngine();
  initLogoutHandler();
  initCopilot();
  initUpload();
  initEmptyState();
  initSummaryModal();

  await loadDocuments(true);
});

/* --- 1. THEME ENGINE --- */
function initThemeEngine() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  const toggle = document.getElementById('themeToggle');
  toggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if (label) label.textContent = theme === 'dark' ? 'Dark Theme' : 'Light Theme';
  }
}

/* --- 2. LOGOUT --- */
function initLogoutHandler() {
  document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (window.UIHelpers) {
      const confirmed = await UIHelpers.confirm({
        title: 'Sign Out',
        message: 'Are you sure you want to sign out of your WarrantyVault session?',
        confirmText: 'Sign Out',
        cancelText: 'Cancel'
      });
      if (!confirmed) return;
    }
    await RouteGuard.logout('./index.html');
  });
}

/* --- 3. COPILOT NAV BUTTON --- */
function initCopilot() {
  document.getElementById('copilotNavBtn')?.addEventListener('click', () => {
    const toggleBtn = document.getElementById('vibecode-chat-toggle-btn');
    if (toggleBtn) {
      toggleBtn.click();
    } else if (window.ChatbotComponent) {
      new window.ChatbotComponent({
        title: 'Warranty & Spend Copilot',
        welcomeMessage: `Hi! I'm your AI Purchase & Warranty Assistant. Ask me about return deadlines, warranty coverage, or spending trends!`
      }).init();
      setTimeout(() => document.getElementById('vibecode-chat-toggle-btn')?.click(), 100);
    }
  });
}

/* --- 4. UPLOAD --- */
function initUpload() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('documentFileInput');
  const chooseBtn = document.getElementById('chooseFileBtn');
  const uploadSelect = document.getElementById('uploadPurchaseSelect');

  const openPicker = () => fileInput?.click();

  chooseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker();
  });
  dropzone?.addEventListener('click', openPicker);
  document.getElementById('openUploadBtn')?.addEventListener('click', () => {
    dropzone?.scrollIntoView({ behavior: 'smooth' });
    openPicker();
  });
  document.getElementById('emptyUploadBtn')?.addEventListener('click', openPicker);

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) uploadFile(file);
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone?.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  // Populate purchase select for linking
  populatePurchaseSelect();
}

async function populatePurchaseSelect() {
  const select = document.getElementById('uploadPurchaseSelect');
  try {
    const res = await PurchaseApi.getPurchases();
    const purchases = (res && res.data) || [];
    if (select) {
      select.innerHTML = '<option value="">Link to a purchase (optional)</option>' +
        purchases.map(p =>
          `<option value="${p.id}">${escapeHtml(p.productName)} — ${escapeHtml(p.storeName || p.merchant || 'Retailer')}</option>`
        ).join('');
    }
  } catch (err) {
    // Non-fatal — linking is optional
  }
}

async function uploadFile(file) {
  // Validate type & size
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif', 'application/pdf'];
  const isImage = file.type.startsWith('image/');
  if (!isImage && file.type !== 'application/pdf') {
    if (window.Toast) Toast.warning('Please upload an image (JPG, PNG, WebP, BMP, HEIC) or a PDF.');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    if (window.Toast) Toast.warning('File is too large. Maximum size is 15 MB.');
    return;
  }

  const progressWrap = document.getElementById('uploadProgress');
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');
  if (progressWrap) progressWrap.style.display = 'block';
  if (fill) fill.style.width = '15%';
  if (text) text.textContent = `Uploading ${file.name}...`;

  try {
    const purchaseId = document.getElementById('uploadPurchaseSelect')?.value || null;
    const res = await DocumentApi.upload(file, purchaseId || null);
    if (fill) fill.style.width = '100%';
    if (text) text.textContent = 'Saved to MongoDB!';
    if (window.Toast) Toast.success('Document uploaded and saved to MongoDB.');
    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = 'none';
      if (fill) fill.style.width = '0%';
    }, 1500);
    await loadDocuments(false);
  } catch (err) {
    if (progressWrap) progressWrap.style.display = 'none';
    if (window.Toast) Toast.error('Upload failed: ' + err.message);
  }
}

/* --- 5. EMPTY STATE --- */
function initEmptyState() {
  document.getElementById('emptyUploadBtn')?.addEventListener('click', () => {
    document.getElementById('openUploadBtn')?.click();
  });
}

/* --- 6. LOAD DOCUMENTS --- */
async function loadDocuments(showSkeleton = false) {
  const grid = document.getElementById('documentsGrid');
  const empty = document.getElementById('documentsEmptyState');
  if (showSkeleton && grid) {
    grid.innerHTML = [1, 2, 3, 4].map(() =>
      '<div class="doc-card" style="opacity: 0.5; pointer-events: none;"><div class="doc-thumb"><i class="fa-solid fa-spinner fa-spin" style="color:#60a5fa;"></i></div><div class="doc-body"><div style="height:12px;width:70%;background:rgba(255,255,255,0.1);border-radius:6px;"></div></div></div>'
    ).join('');
  }
  if (empty) empty.style.display = 'none';

  try {
    const res = await DocumentApi.getDocuments();
    allDocuments = (res && res.data) || [];
    renderDocuments();
  } catch (err) {
    if (window.Toast) Toast.error('Failed to load documents: ' + err.message);
    if (grid) {
      grid.style.display = 'grid';
      grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>Could not load documents</h3><p>Please try again.</p></div>`;
    }
  }
}

/* --- 7. RENDER --- */
function renderDocuments() {
  const grid = document.getElementById('documentsGrid');
  const empty = document.getElementById('documentsEmptyState');
  if (!grid) return;

  if (allDocuments.length === 0) {
    grid.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  if (empty) empty.style.display = 'none';
  grid.innerHTML = allDocuments.map(renderDocCard).join('');
  attachDocHandlers();
}

function renderDocCard(d) {
  const isImage = (d.mimeType || '').startsWith('image/');
  const isPdf = (d.mimeType || '') === 'application/pdf' || (d.fileUrl || '').toLowerCase().endsWith('.pdf');
  const sizeText = formatBytes(d.fileSize);
  // Extract product name from linked purchase, doc, or summary
  let prodName = (d.linkedPurchase && d.linkedPurchase.productName) || d.productName;
  if (!prodName && d.summary) {
    const pMatch = d.summary.match(/•\s*(?:Product Name|Product)\s*:\s*([^\n\r]+)/i);
    if (pMatch && pMatch[1]) prodName = pMatch[1].trim();
  }
  if (!prodName && d.originalFileName) {
    const clean = d.originalFileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
    if (!clean.toLowerCase().includes('screenshot')) {
      prodName = clean;
    }
  }

  const linkedText = prodName
    ? `<span class="doc-linked" title="${escapeHtml(prodName)}"><i class="fa-solid fa-link"></i> ${escapeHtml(prodName)}</span>`
    : '';

  const thumb = isImage
    ? `<img src="${d.fileUrl}" alt="receipt" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="file-icon" style="display:none;"><i class="fa-solid fa-image"></i></div>`
    : isPdf
      ? `<i class="fa-solid fa-file-pdf file-icon" style="color:#ef4444;"></i><span class="pdf-badge">PDF</span>`
      : `<i class="fa-solid fa-file-lines file-icon"></i>`;

  return `
    <div class="doc-card" data-id="${d.id}">
      <div class="doc-thumb" style="cursor: pointer;" onclick="window.open('${d.fileUrl}', '_blank')" title="Click to view document in a new tab">
        ${thumb}
      </div>
      <div class="doc-body">
        <span class="doc-name" title="${escapeHtml(d.originalFileName)}">${escapeHtml(d.originalFileName)}</span>
        ${linkedText}
        <div class="doc-meta">
          <span><i class="fa-regular fa-calendar"></i> ${fmtDate(d.uploadedAt)}</span>
          <span><i class="fa-solid fa-weight-hanging"></i> ${sizeText}</span>
        </div>
        <button class="doc-summary-btn view-summary-btn" data-id="${d.id}">
          <i class="fa-solid fa-wand-magic-sparkles"></i> View Summary
        </button>
      </div>
      <div class="doc-actions">
        <a class="doc-action-btn" href="${d.fileUrl}" target="_blank" rel="noopener noreferrer" onclick="window.open('${d.fileUrl}', '_blank'); return false;" title="View document in new tab">
          <i class="fa-solid fa-eye"></i> View
        </a>
        <button class="doc-action-btn danger delete-doc-btn" data-id="${d.id}"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
  `;
}

function attachDocHandlers() {
  document.querySelectorAll('.view-summary-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      openDocSummaryModal(id);
    });
  });

  document.querySelectorAll('.delete-doc-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (window.UIHelpers) {
        const confirmed = await UIHelpers.confirm({
          title: 'Delete Document',
          message: 'This will permanently remove the document and its stored file. This cannot be undone.',
          confirmText: 'Delete',
          isDanger: true
        });
        if (!confirmed) return;
      }
      try {
        await DocumentApi.deleteDocument(id);
        if (window.Toast) Toast.success('Document deleted.');
        allDocuments = allDocuments.filter(d => d.id !== id);
        renderDocuments();
      } catch (err) {
        if (window.Toast) Toast.error('Failed to delete document: ' + err.message);
      }
    });
  });
}

/* --- Helpers --- */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fmtDate(d) {
  if (!d) return 'N/A';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSummaryHtml(summaryStr, linkedPurchase) {
  if (!summaryStr && !linkedPurchase) {
    return `<div class="doc-summary-text empty"><i class="fa-solid fa-circle-info"></i> Summary unavailable</div>`;
  }

  const text = (summaryStr || '').trim();
  let items = [];

  if (text) {
    const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const hasExplicitBullets = rawLines.some(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*'));

    if (hasExplicitBullets || rawLines.length > 1) {
      items = rawLines.map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
    } else {
      // Natural language paragraph: split sentences into structured items
      items = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
    }
  }

  // Fallback to linked purchase fields if items empty
  if (items.length === 0 && linkedPurchase) {
    if (linkedPurchase.productName) items.push(`Product: ${linkedPurchase.productName}`);
    if (linkedPurchase.amount !== undefined) items.push(`Amount: ${linkedPurchase.currency || '₹'}${linkedPurchase.amount}`);
    if (linkedPurchase.storeName) items.push(`Merchant: ${linkedPurchase.storeName}`);
  }

  if (items.length === 0) {
    return `<div class="doc-summary-text empty"><i class="fa-solid fa-circle-info"></i> Summary unavailable</div>`;
  }

  const listHtml = items.map(item => {
    // Match "Key: Value" or "Key - Value"
    const match = item.match(/^([A-Za-z\s\/\-_]+)\s*[:\-]\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      let icon = 'fa-solid fa-circle-dot';
      const keyLower = key.toLowerCase();
      if (keyLower.includes('product') || keyLower.includes('item')) icon = 'fa-solid fa-box';
      else if (keyLower.includes('amount') || keyLower.includes('price') || keyLower.includes('cost')) icon = 'fa-solid fa-tag';
      else if (keyLower.includes('merchant') || keyLower.includes('store') || keyLower.includes('retailer') || keyLower.includes('shop')) icon = 'fa-solid fa-store';
      else if (keyLower.includes('date') || keyLower.includes('purchased')) icon = 'fa-regular fa-calendar-check';
      else if (keyLower.includes('warranty')) icon = 'fa-solid fa-shield-halved';
      else if (keyLower.includes('return')) icon = 'fa-solid fa-clock-rotate-left';
      else if (keyLower.includes('invoice') || keyLower.includes('order') || keyLower.includes('ref')) icon = 'fa-solid fa-receipt';

      return `
        <li class="summary-bullet-item">
          <i class="${icon} summary-bullet-icon"></i>
          <span class="summary-bullet-key">${escapeHtml(key)}:</span>
          <span class="summary-bullet-val">${escapeHtml(val)}</span>
        </li>
      `;
    }

    return `
      <li class="summary-bullet-item">
        <i class="fa-solid fa-circle-dot summary-bullet-icon"></i>
        <span class="summary-bullet-val">${escapeHtml(item)}</span>
      </li>
    `;
  }).join('');

  return `<ul class="doc-summary-bullet-list">${listHtml}</ul>`;
}

/* --- 8. AI BILL SUMMARY MODAL WITH TRANSLATION & VOICE --- */
let activeSummaryTextToCopy = '';
let activeModalDocId = null;
const docLanguageState = {};
let isCurrentlySpeaking = false;
let currentSpeechSessionId = 0;
let activeTtsAudio = null;
let activeUtterance = null;

// 7 Supported Languages (Marathi priority support)
const LANG_METADATA = {
  'en': { name: 'English', locale: 'en-IN', fallbackLocale: 'en-US' },
  'mr': { name: 'Marathi', locale: 'mr-IN', fallbackLocale: 'hi-IN' },
  'hi': { name: 'Hindi', locale: 'hi-IN', fallbackLocale: 'hi' },
  'gu': { name: 'Gujarati', locale: 'gu-IN', fallbackLocale: 'hi-IN' },
  'bho': { name: 'Bhojpuri', locale: 'hi-IN', fallbackLocale: 'hi' },
  'bn': { name: 'Bengali', locale: 'bn-IN', fallbackLocale: 'hi-IN' },
  'ta': { name: 'Tamil', locale: 'ta-IN', fallbackLocale: 'en-IN' }
};

// Pre-load / prime speech synthesis voices
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    try {
      window.speechSynthesis.getVoices();
    } catch (_) {}
  };
}

function updateVoiceButtonUI(isSpeaking, lang = 'en') {
  const voiceBtn = document.getElementById('summaryModalVoiceBtn');
  const voiceIcon = document.getElementById('summaryModalVoiceIcon');
  const voiceLabel = document.getElementById('summaryModalVoiceLabel');
  const voiceBars = document.getElementById('summaryVoiceBars');

  if (voiceBtn) {
    if (isSpeaking) {
      voiceBtn.classList.add('speaking');
      voiceBtn.title = 'Click to stop voice playback';
    } else {
      voiceBtn.classList.remove('speaking');
      voiceBtn.title = 'Listen to summary in selected language (Marathi, English, Hindi)';
    }
  }
  if (voiceIcon) {
    voiceIcon.className = isSpeaking ? 'fa-solid fa-circle-stop' : 'fa-solid fa-volume-high';
  }
  if (voiceLabel) {
    if (isSpeaking) {
      voiceLabel.textContent = (lang === 'mr') ? 'Stop' : 'Stop';
    } else {
      voiceLabel.textContent = 'Voice';
    }
  }
  if (voiceBars) {
    voiceBars.style.display = isSpeaking ? 'inline-flex' : 'none';
  }
}

function initSummaryModal() {
  const overlay = document.getElementById('summaryModalOverlay');
  const closeBtn = document.getElementById('summaryModalCloseBtn');
  const copyBtn = document.getElementById('copySummaryBtn');
  const langSelect = document.getElementById('summaryModalLangSelect');
  const voiceBtn = document.getElementById('summaryModalVoiceBtn');

  const closeModal = () => {
    stopSummarySpeech();
    if (overlay) overlay.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closeModal);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') {
      closeModal();
    }
  });

  // Language Dropdown Selector Change
  langSelect?.addEventListener('change', async (e) => {
    const targetLang = e.target.value;
    if (!activeModalDocId) return;
    await applyModalLanguage(activeModalDocId, targetLang);
  });

  // Copy Translated / Original Summary Button
  copyBtn?.addEventListener('click', async () => {
    if (!activeSummaryTextToCopy) {
      if (window.Toast) Toast.warning('No summary text to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(activeSummaryTextToCopy);
      if (window.Toast) Toast.success('Summary copied to clipboard!');
      const origHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
      setTimeout(() => { copyBtn.innerHTML = origHtml; }, 2000);
    } catch (err) {
      if (window.Toast) Toast.error('Could not copy to clipboard.');
    }
  });

  // Voice Speech Synthesis Toggle Button
  voiceBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (isCurrentlySpeaking) {
      stopSummarySpeech();
    } else {
      startSummarySpeech();
    }
  });
}

async function openDocSummaryModal(docId) {
  const doc = allDocuments.find(d => String(d.id) === String(docId) || String(d._id) === String(docId));
  if (!doc) return;

  activeModalDocId = docId;
  const overlay = document.getElementById('summaryModalOverlay');
  const nameEl = document.getElementById('summaryModalDocName');
  const previewWrap = document.getElementById('summaryModalPreview');
  const imgEl = document.getElementById('summaryModalImg');
  const viewBtn = document.getElementById('openFullReceiptBtn') || document.getElementById('summaryModalViewBtn');
  const langSelect = document.getElementById('summaryModalLangSelect');

  if (nameEl) nameEl.textContent = doc.originalFileName || 'Receipt Document';

  const isImage = (doc.mimeType || '').startsWith('image/');
  if (previewWrap && imgEl) {
    if (isImage && doc.fileUrl) {
      previewWrap.style.display = 'flex';
      imgEl.src = doc.fileUrl;
    } else {
      previewWrap.style.display = 'none';
    }
  }

  if (viewBtn) {
    viewBtn.href = doc.fileUrl || '#';
    viewBtn.onclick = (e) => {
      e.preventDefault();
      window.open(doc.fileUrl, '_blank');
    };
  }

  // Restore or default language
  const currentLang = docLanguageState[docId] || 'en';
  if (langSelect) langSelect.value = currentLang;

  await applyModalLanguage(docId, currentLang);

  if (overlay) {
    overlay.style.display = 'flex';
  }
}

const openSummaryModal = openDocSummaryModal;

async function applyModalLanguage(docId, targetLang) {
  const doc = allDocuments.find(d => String(d.id) === String(docId) || String(d._id) === String(docId));
  if (!doc) return;

  docLanguageState[docId] = targetLang;
  const contentEl = document.getElementById('summaryModalContent');
  stopSummarySpeech();

  // 1. English (Source)
  if (targetLang === 'en') {
    activeSummaryTextToCopy = doc.summary || (doc.linkedPurchase ? `${doc.linkedPurchase.productName} - ${doc.linkedPurchase.amount}` : '');
    if (contentEl) contentEl.innerHTML = formatSummaryHtml(doc.summary, doc.linkedPurchase);
    return;
  }

  // 2. Check cached translation
  if (doc.translations && doc.translations[targetLang]) {
    const cachedText = doc.translations[targetLang];
    activeSummaryTextToCopy = cachedText;
    if (contentEl) contentEl.innerHTML = formatSummaryHtml(cachedText);
    return;
  }

  // 3. Fetch live translation from server
  if (contentEl) {
    const langName = (LANG_METADATA[targetLang] && LANG_METADATA[targetLang].name) || targetLang;
    contentEl.innerHTML = `
      <div style="padding: 28px; text-align: center; color: #a5b4fc;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; margin-bottom: 10px; display: block; color: #818cf8;"></i>
        <span>Translating summary to <strong>${escapeHtml(langName)}</strong>...</span>
      </div>
    `;
  }

  try {
    const res = await DocumentApi.translateDocument(docId, targetLang);
    if (res && res.success && res.translation) {
      if (!doc.translations) doc.translations = {};
      doc.translations[targetLang] = res.translation;
      activeSummaryTextToCopy = res.translation;
      if (contentEl) contentEl.innerHTML = formatSummaryHtml(res.translation);
    } else {
      throw new Error(res?.message || 'Translation unavailable.');
    }
  } catch (err) {
    if (window.Toast) Toast.warning(`Translation unavailable for ${targetLang.toUpperCase()}: ${err.message}`);
    // Fall back to original English summary
    activeSummaryTextToCopy = doc.summary || '';
    if (contentEl) {
      contentEl.innerHTML = `
        <div style="margin-bottom: 10px; font-size: 0.78rem; color: #fbbf24;">
          <i class="fa-solid fa-circle-exclamation"></i> Translation unavailable. Showing original summary:
        </div>
        ${formatSummaryHtml(doc.summary, doc.linkedPurchase)}
      `;
    }
  }
}

/* --- 9. NATIVE VOICE SUMMARY (Sentence-Queue Engine with Instant Stop) --- */
let speechSentenceQueue = [];

function startSummarySpeech() {
  const docId = activeModalDocId;
  const currentLang = (docId && docLanguageState[docId]) || 'en';
  const textToSpeak = activeSummaryTextToCopy;

  if (!textToSpeak || !textToSpeak.trim()) {
    if (window.Toast) Toast.warning('No summary text available to read.');
    return;
  }

  // 1. Force stop any existing speech session immediately
  stopSummarySpeech();

  const thisSessionId = ++currentSpeechSessionId;
  isCurrentlySpeaking = true;
  updateVoiceButtonUI(true, currentLang);

  // 2. Format text for natural pronunciation in Marathi, Hindi & English
  const isMarathi = currentLang === 'mr';
  const isHindi = currentLang === 'hi';
  const currencyWord = isMarathi ? ' रुपये ' : (isHindi ? ' रुपये ' : ' Rupees ');

  let preparedText = textToSpeak
    .replace(/[₹]/g, currencyWord)
    .replace(/Rs\.?/gi, currencyWord)
    .replace(/[•\-\*]/g, ' ')
    .trim();

  // 3. Break summary into small, discrete sentence chunks so stop is instant
  const rawPhrases = preparedText
    .split(/\r?\n|\.|\u0964/) // split by newlines, periods, or Devanagari danda
    .map(line => {
      return line
        .replace(/^[•\-\*]\s*/, '')
        .replace(/:\s*/, ' — ')
        .trim();
    })
    .filter(line => line.length > 0);

  speechSentenceQueue = rawPhrases.length > 0 ? rawPhrases : [preparedText];

  // 4. Start speaking sentence-by-sentence
  speakNextQueuedSentence(currentLang, thisSessionId);
}

function speakNextQueuedSentence(lang, sessionId) {
  // If user clicked stop or session has changed, abort immediately
  if (!isCurrentlySpeaking || sessionId !== currentSpeechSessionId || speechSentenceQueue.length === 0) {
    if (sessionId === currentSpeechSessionId && isCurrentlySpeaking) {
      stopSummarySpeech();
    }
    return;
  }

  const nextText = speechSentenceQueue.shift();
  if (!nextText || !nextText.trim()) {
    speakNextQueuedSentence(lang, sessionId);
    return;
  }

  // Use Web Speech Synthesis with micro-sentences
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}

    const utterance = new SpeechSynthesisUtterance(nextText.trim());
    activeUtterance = utterance;

    const langMeta = LANG_METADATA[lang] || LANG_METADATA['en'];
    utterance.lang = langMeta.locale || 'mr-IN';

    // Find best voice match for Marathi or selected language
    const availableVoices = window.speechSynthesis.getVoices() || [];
    const targetCode = (lang || '').toLowerCase();

    let matchingVoice = availableVoices.find(v => {
      const vLang = (v.lang || '').toLowerCase();
      return vLang === (langMeta.locale || '').toLowerCase() ||
             vLang === targetCode ||
             vLang.startsWith(targetCode + '-') ||
             vLang.startsWith(targetCode + '_');
    });

    if (!matchingVoice) {
      matchingVoice = availableVoices.find(v => (v.name || '').toLowerCase().includes(langMeta.name.toLowerCase()));
    }

    if (!matchingVoice && langMeta.fallbackLocale) {
      const fbCode = langMeta.fallbackLocale.toLowerCase();
      matchingVoice = availableVoices.find(v => {
        const vLang = (v.lang || '').toLowerCase();
        const vName = (v.name || '').toLowerCase();
        return vLang === fbCode || vLang.startsWith(fbCode + '-') || vName.includes('marathi') || vName.includes('hindi') || vName.includes('india');
      });
    }

    if (matchingVoice) {
      utterance.voice = matchingVoice;
      utterance.lang = matchingVoice.lang || langMeta.locale;
    }

    utterance.rate = 0.92;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      if (sessionId !== currentSpeechSessionId || !isCurrentlySpeaking) return;
      // Pause slightly between phrases for natural pacing
      setTimeout(() => {
        if (sessionId === currentSpeechSessionId && isCurrentlySpeaking) {
          speakNextQueuedSentence(lang, sessionId);
        }
      }, 80);
    };

    utterance.onerror = (e) => {
      if (sessionId !== currentSpeechSessionId || !isCurrentlySpeaking) return;
      speakNextQueuedSentence(lang, sessionId);
    };

    window.speechSynthesis.speak(utterance);
  } else {
    // Fallback if browser does not support Web Speech
    stopSummarySpeech();
    if (window.Toast) Toast.warning('Speech synthesis is not supported on this browser.');
  }
}

function stopSummarySpeech() {
  // 1. Invalidate session and clear pending queue
  currentSpeechSessionId++;
  isCurrentlySpeaking = false;
  speechSentenceQueue = [];

  // 2. Abort and unload HTML5 audio stream if any
  if (activeTtsAudio) {
    try {
      activeTtsAudio.onended = null;
      activeTtsAudio.onerror = null;
      activeTtsAudio.pause();
      activeTtsAudio.currentTime = 0;
      activeTtsAudio.src = '';
      if (typeof activeTtsAudio.load === 'function') {
        activeTtsAudio.load();
      }
    } catch (_) {}
    activeTtsAudio = null;
  }

  // 3. Immediately halt browser speech synthesis
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      if (activeUtterance) {
        activeUtterance.onend = null;
        activeUtterance.onerror = null;
        activeUtterance = null;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.cancel();
      // Double cancel ensures browser queue is purged
      setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
        } catch (_) {}
      }, 10);
    } catch (_) {}
  }

  // 4. Reset Voice button UI
  updateVoiceButtonUI(false);
}
