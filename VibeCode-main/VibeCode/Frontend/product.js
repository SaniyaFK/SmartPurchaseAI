/**
 * Purchases & Warranty Vault Logic — WarrantyVault AI
 * Connected to MongoDB Compass & Express REST Backend
 */

let purchasesList = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (window.RouteGuard) {
    await RouteGuard.checkAuth();
  }

  // Initialize Chatbot Copilot Widget
  if (window.ChatbotComponent) {
    new window.ChatbotComponent({
      title: 'Warranty & Spend Copilot',
      welcomeMessage: `Welcome to your Purchases & Warranty Vault! You can search any bill, inspect active return windows, or generate 1-click warranty claim letters.`
    }).init();
  }

  initThemeEngine();
  initCopilotNav();
  initModalHandlers();
  initFilterAndSortHandlers();
  initFormMutations();
  initExportHandler();

  // Check URL params for quick actions (e.g. ?action=add)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'add') {
    document.getElementById('addProductModal')?.classList.add('active');
  }
  
  // Fetch live purchase records from MongoDB
  await fetchPurchases();
});

/* --- 0. PURCHASE COPILOT NAV BUTTON opens chatbot --- */
function initCopilotNav() {
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

/* --- 1. THEME ENGINE --- */
function initThemeEngine() {
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = document.getElementById('themeLabel');
  
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  themeToggle?.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (themeIcon) themeIcon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Dark Theme' : 'Light Theme';
  }
}

/* --- 2. FETCH PURCHASES FROM MONGODB --- */
async function fetchPurchases() {
  renderSkeletons();
  try {
    const res = await PurchaseApi.getPurchases();
    if (res.success && Array.isArray(res.data)) {
      purchasesList = res.data;
    } else {
      purchasesList = [];
    }
    renderPurchases(purchasesList);
  } catch (err) {
    console.error('Failed to load purchases from database:', err);
    if (window.Toast) Toast.error('Error loading vault purchases: ' + err.message);
  }
}

/* --- 3. RENDER PURCHASES GRID --- */
function renderPurchases(items) {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted);">
        <i class="fa-solid fa-vault" style="font-size: 2.5rem; margin-bottom: 12px; color: var(--accent-blue);"></i>
        <h3>No purchases found matching your filters</h3>
        <p style="margin-top: 6px; font-size: 0.9rem;">Click "+ Add / Scan Purchase" to add bills and receipts to your vault.</p>
      </div>
    `;
    return;
  }

  items.forEach(product => {
    const pDate = new Date(product.purchaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const imgUrl = getProductImageUrl(product);

    let statusBadgeClass = 'active';
    let statusText = 'Active Coverage';
    if (product.status === 'expiring_soon' || (product.daysUntilWarrantyExpiry > 0 && product.daysUntilWarrantyExpiry <= 30)) {
      statusBadgeClass = 'expiring_soon';
      statusText = `Expiring (${product.daysUntilWarrantyExpiry}d)`;
    } else if (product.status === 'expired' || product.daysUntilWarrantyExpiry <= 0) {
      statusBadgeClass = 'expired';
      statusText = 'Warranty Expired';
    } else if (product.status === 'claimed') {
      statusBadgeClass = 'claimed';
      statusText = 'Claim Filed';
    }

    let returnBadge = product.daysUntilReturnDeadline > 0
      ? `<span class="return-chip ${product.daysUntilReturnDeadline <= 7 ? 'urgent' : ''}"><i class="fa-solid fa-arrow-rotate-left"></i> ${product.daysUntilReturnDeadline}d Return</span>`
      : `<span class="return-chip closed">Return Closed</span>`;

    const cleanTitle = cleanProductTitle(product.productName, product.items);

    const card = document.createElement('article');
    card.className = 'product-card glass card-gradient-inverted loaded';
    card.innerHTML = `
      <div class="product-thumb">
        <img src="${imgUrl}" alt="${escapeHtml(cleanTitle)}" onerror="this.src='https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=400&q=80'" />
        <div class="thumb-floating-badges">
          <span class="status-badge ${statusBadgeClass}"><i class="fa-solid fa-circle"></i> ${statusText}</span>
          ${returnBadge}
        </div>
      </div>
      <div class="product-body">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="product-category">${escapeHtml(product.category)}</span>
          <span class="store-badge"><i class="fa-solid fa-shop"></i> ${escapeHtml(product.storeName)}</span>
        </div>
        <h4 class="product-title" title="${escapeHtml(product.productName)}">${escapeHtml(cleanTitle)}</h4>
        <div class="product-meta-row">
          <span><i class="fa-regular fa-calendar"></i> ${pDate}</span>
          <span><i class="fa-solid fa-shield"></i> ${product.warrantyMonths} Mo. Warranty</span>
        </div>
        <div class="product-footer">
          <span class="product-price">${window.getCurrencySymbol ? getCurrencySymbol(product.currency) : '₹'}${parseFloat(product.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          <div class="card-actions-row">
            <button class="icon-action-btn" title="Inspect & File Claim" onclick="event.stopPropagation(); openDetailModal('${product.id || product._id}');">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
            </button>
            <button class="icon-action-btn delete" title="Delete Purchase" onclick="event.stopPropagation(); deletePurchaseItem('${product.id || product._id}', '${escapeHtml(cleanTitle)}');">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openDetailModal(product.id || product._id));
    grid.appendChild(card);
  });
}

/* --- 4. MODALS & INSPECTION LOGIC --- */
function initModalHandlers() {
  const detailModal = document.getElementById('productDetailModal');
  const addModal = document.getElementById('addProductModal');
  const navAddScanBtn = document.getElementById('navAddScanBtn');

  document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => {
    detailModal?.classList.remove('active');
  });

  document.getElementById('openAddModalBtn')?.addEventListener('click', () => {
    addModal?.classList.add('active');
  });

  navAddScanBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    addModal?.classList.add('active');
  });

  document.getElementById('closeAddModalBtn')?.addEventListener('click', () => {
    addModal?.classList.remove('active');
  });

  // Real receipt scan inside Add Modal: actual image -> OCR -> Gemini -> auto-fill
  const addScanInput = document.getElementById('addModalReceiptInput');
  document.getElementById('addModalScanReceiptBtn')?.addEventListener('click', () => {
    addScanInput?.click();
  });
  addScanInput?.addEventListener('change', async () => {
    const file = addScanInput.files && addScanInput.files[0];
    if (!file) return;
    if (window.AiScanLoader) AiScanLoader.show(file.name);
    if (window.Toast) Toast.info(`AI scanning ${file.name}...`);
    try {
      const res = await PurchaseApi.scanReceiptFile(file);
      if (res.success && res.data) {
        const d = res.data;
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.value = (v === null || v === undefined || v === '') ? '' : v;
        };
        set('newProdName', d.productName || d.product);
        set('newProdBrand', d.brand);
        set('newProdStore', d.merchant || d.storeName);
        set('newProdCategory', d.category || 'Electronics');
        set('newProdPrice', d.amount !== null && d.amount !== undefined ? d.amount : d.price);
        set('newProdDate', d.purchaseDate || d.date);
        set('newProdWarrantyMonths', d.warrantyMonths || 12);
        set('newProdReturnDays', d.returnPeriodDays || 30);
        if (d.isDuplicate) {
          if (window.Toast) Toast.error('You already have this bill in the system!');
        } else {
          if (window.Toast) Toast.success('Receipt scanned — review the auto-filled fields before saving.');
        }
      }
    } catch (err) {
      if (window.Toast) Toast.error('AI Scan Error: ' + err.message);
    } finally {
      if (window.AiScanLoader) AiScanLoader.hide();
      addScanInput.value = '';
    }
  });

  // Sample Auto-fill buttons inside Add Modal
  document.querySelectorAll('.mini-sample-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sampleId = btn.getAttribute('data-sample');
      const sampleName = btn.innerText.trim();
      if (window.AiScanLoader) AiScanLoader.show(`${sampleName} Sample Bill`);
      try {
        const res = await PurchaseApi.scanSample(sampleId);
        if (res.success && res.data) {
          const d = res.data;
          document.getElementById('newProdName').value = d.productName || '';
          document.getElementById('newProdBrand').value = d.brand || '';
          document.getElementById('newProdStore').value = d.storeName || '';
          document.getElementById('newProdCategory').value = d.category || 'Electronics';
          document.getElementById('newProdPrice').value = d.price || '';
          document.getElementById('newProdDate').value = d.purchaseDate ? new Date(d.purchaseDate).toISOString().split('T')[0] : '';
          document.getElementById('newProdWarrantyMonths').value = d.warrantyMonths || 12;
          document.getElementById('newProdReturnDays').value = d.returnPeriodDays || 30;
          document.getElementById('newProdSerial').value = d.serialNumber || '';
          document.getElementById('newProdInvoice').value = d.invoiceNumber || '';
          document.getElementById('newProdImg').value = d.receiptImageUrl || '';
          document.getElementById('newProdDesc').value = d.notes || '';
          if (window.Toast) Toast.success(`Auto-filled with ${sampleName} details!`);
        }
      } catch (err) {
        if (window.Toast) Toast.error('Failed to auto-fill: ' + err.message);
      } finally {
        if (window.AiScanLoader) AiScanLoader.hide();
      }
    });
  });
}

window.openDetailModal = function(id) {
  const item = purchasesList.find(p => (p.id === id || p._id === id));
  if (!item) return;

  const detailBody = document.getElementById('productDetailBody');
  const modal = document.getElementById('productDetailModal');
  if (!detailBody || !modal) return;

  const pDate = new Date(item.purchaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const expDate = new Date(item.warrantyExpiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const retDate = new Date(item.returnDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  detailBody.innerHTML = `
    <div class="detail-media">
      <img id="detailImg" src="${getProductImageUrl(item)}" alt="Receipt" />
      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <a href="${item.receiptImageUrl || getProductImageUrl(item)}" target="_blank" class="detail-link-btn"><i class="fa-solid fa-up-right-from-square"></i> Open High-Res Receipt</a>
      </div>
    </div>
    <div class="detail-info">
      ${item.isAnomaly ? `
        <div style="background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.4); color: #facc15; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>${escapeHtml(item.anomalyNotice || 'Unusual spending detected: This purchase is significantly different from your usual spending pattern.')}</span>
        </div>
      ` : ''}
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
        <div>
          <span class="detail-category">${escapeHtml(item.category)} • ${escapeHtml(item.storeName)}</span>
          <h2 id="detailName">${escapeHtml(item.productName)}</h2>
        </div>
        <span class="detail-price">${window.getCurrencySymbol ? getCurrencySymbol(item.currency) : '₹'}${parseFloat(item.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
      </div>

      <!-- Live Coverage Counters -->
      <div class="detail-counters-grid">
        <div class="counter-box">
          <span class="counter-label">WARRANTY STATUS</span>
          <div class="counter-val ${item.daysUntilWarrantyExpiry > 0 ? 'text-green' : 'text-red'}">
            ${item.daysUntilWarrantyExpiry > 0 ? `${item.daysUntilWarrantyExpiry} Days Left` : 'Warranty Expired'}
          </div>
          <small>Valid until: <strong>${expDate}</strong></small>
        </div>

        <div class="counter-box">
          <span class="counter-label">RETURN DEADLINE</span>
          <div class="counter-val ${item.daysUntilReturnDeadline > 0 ? 'text-blue' : 'text-red'}">
            ${item.daysUntilReturnDeadline > 0 ? `${item.daysUntilReturnDeadline} Days Left` : 'Return Window Closed'}
          </div>
          <small>Policy Deadline: <strong>${retDate}</strong></small>
        </div>
      </div>

      ${item.summary ? `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px; padding: 12px 14px; margin: 12px 0;">
          <div style="font-size: 0.72rem; font-weight: 800; color: #818CF8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-wand-magic-sparkles"></i> AI Bill Summary
          </div>
          <div style="font-size: 0.82rem; line-height: 1.5; color: var(--text-main, #f8fafc);">
            ${formatSummaryBullets(item.summary)}
          </div>
        </div>
      ` : ''}

      <!-- Identification Details -->
      <div class="meta-specs-box">
        <div><strong>Serial / IMEI:</strong> <code id="serialCodeVal">${escapeHtml(item.serialNumber || 'N/A')}</code> 
          ${item.serialNumber ? `<button class="copy-tiny-btn" onclick="copySerial('${item.serialNumber}')"><i class="fa-regular fa-copy"></i></button>` : ''}
        </div>
        <div><strong>Invoice Number:</strong> <code>${escapeHtml(item.invoiceNumber || 'N/A')}</code></div>
        <div><strong>Purchase Date:</strong> ${pDate}</div>
        <div><strong>Payment Method:</strong> ${escapeHtml(item.paymentMethod || 'Credit Card')}</div>
      </div>

      <p class="detail-description">${escapeHtml(item.notes || 'Verified purchase registered in MongoDB Compass database.')}</p>
      
      <div class="detail-actions" style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="submit-action-btn" style="background: linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%);" onclick="openClaimAssistant('${item.id || item._id}')">
          <i class="fa-solid fa-wand-magic-sparkles"></i> 1-Click AI Warranty Claim
        </button>
        <button class="submit-action-btn" style="background: linear-gradient(135deg, #F59E0B 0%, #EF4444 100%);" onclick="sendWarrantyReminderEmail('${item.id || item._id}')">
          <i class="fa-solid fa-bell"></i> Send Warranty Reminder
        </button>
      </div>
    </div>
  `;

  modal.classList.add('active');
};

window.copySerial = function(serial) {
  navigator.clipboard.writeText(serial);
  if (window.Toast) Toast.success('Serial number copied to clipboard!');
};

window.openClaimAssistant = function(id) {
  const item = purchasesList.find(p => (p.id === id || p._id === id));
  if (!item) return;

  const detailBody = document.getElementById('productDetailBody');
  if (!detailBody) return;

  detailBody.innerHTML = `
    <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 1.25rem; font-weight: 800;"><i class="fa-solid fa-wand-magic-sparkles" style="color: #EC4899;"></i> AI Warranty Claim & Dispute Generator</h3>
        <button class="detail-link-btn" onclick="openDetailModal('${id}')"><i class="fa-solid fa-arrow-left"></i> Back</button>
      </div>
      <p style="font-size: 0.88rem; color: var(--text-muted);">
        Craft a formal, legally structured manufacturer warranty claim for <strong>${escapeHtml(item.productName)}</strong>.
      </p>

      <form id="vaultClaimForm">
        <div class="field-row">
          <div class="field">
            <label>Defect Category</label>
            <select id="vClaimCategory" required>
              <option value="Hardware Defect / Operational Failure">Hardware Defect / Stopped Working</option>
              <option value="Power / Battery Failure">Power / Charging / Battery Degradation</option>
              <option value="Display / Pixel Defect">Screen Display / Dead Pixels</option>
              <option value="Mechanical Failure">Mechanical Part Breakage</option>
              <option value="Audio Distortion">Audio / Speaker Malfunction</option>
            </select>
          </div>
          <div class="field">
            <label>Desired Resolution</label>
            <select id="vClaimResolution" required>
              <option value="Official Warranty Repair / Free Part Replacement">Official Warranty Repair / Free Part Replacement</option>
              <option value="Direct Replacement with Brand New Unit">Direct Replacement with Brand New Unit</option>
              <option value="Full Purchase Refund">Full Purchase Refund</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Issue Description</label>
          <textarea id="vClaimDesc" rows="3" required placeholder="Describe the defect in detail (e.g. Device ceased functioning under standard operating conditions...)"></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px;">
          <button type="button" class="btn-cancel" onclick="openDetailModal('${id}')">Cancel</button>
          <button type="submit" class="submit-action-btn" style="background: linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%);">
            <i class="fa-solid fa-file-pen"></i> Generate Claim Letter
          </button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('vaultClaimForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const issueCategory = document.getElementById('vClaimCategory').value;
    const desiredResolution = document.getElementById('vClaimResolution').value;
    const issueDescription = document.getElementById('vClaimDesc').value;

    if (window.Toast) Toast.info('AI drafting warranty claim letter...');

    try {
      // Task 6: file through the Claims API — saved to MongoDB Claim
      // collection, purchase marked as claimed, notification sent.
      const res = await ClaimApi.createClaim({
        purchaseId: id,
        issueCategory,
        desiredResolution,
        issueDescription
      });

      if (res.success && res.data) {
        displayVaultClaimLetter(res.data, id);
        if (window.Toast) Toast.success('Claim filed and letter generated successfully!');
      }
    } catch (err) {
      if (window.Toast) Toast.error('Error generating claim: ' + err.message);
    }
  });
};

function displayVaultClaimLetter(letterData, id) {
  const detailBody = document.getElementById('productDetailBody');
  if (!detailBody) return;

  detailBody.innerHTML = `
    <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 1.2rem; font-weight: 800; color: #10B981;"><i class="fa-solid fa-circle-check"></i> Formal Claim Letter Drafted</h3>
        <button class="btn-export" onclick="copyClaimLetterVault()"><i class="fa-regular fa-copy"></i> Copy Text</button>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted);">Subject: ${escapeHtml(letterData.letterSubject || letterData.subject)}</p>

      <textarea id="vaultLetterTextarea" readonly rows="12" style="width: 100%; background: var(--input-bg); border: 1px solid var(--glass-border); border-radius: 12px; padding: 14px; color: var(--text-main); font-family: monospace; font-size: 0.82rem; line-height: 1.45;">${escapeHtml(letterData.letterContent || letterData.letterBody)}</textarea>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <button class="btn-cancel" onclick="openDetailModal('${id}')">Back to Details</button>
        <button class="submit-action-btn" onclick="copyClaimLetterVault()"><i class="fa-solid fa-envelope"></i> Copy to Email</button>
      </div>
    </div>
  `;
}

window.copyClaimLetterVault = function() {
  const t = document.getElementById('vaultLetterTextarea');
  if (t) {
    t.select();
    navigator.clipboard.writeText(t.value);
    if (window.Toast) Toast.success('Warranty claim letter copied to clipboard!');
  }
};

window.deletePurchaseItem = async function(id, name) {
  if (window.UIHelpers) {
    const confirmed = await UIHelpers.confirm({
      title: 'Delete Purchase',
      message: `Are you sure you want to remove "${name}" from your vault?`,
      confirmText: 'Delete',
      cancelText: 'Cancel'
    });
    if (!confirmed) return;
  }

  try {
    const res = await PurchaseApi.deletePurchase(id);
    if (res.success) {
      if (window.Toast) Toast.success(`Removed "${name}" from vault.`);
      purchasesList = purchasesList.filter(p => (p.id !== id && p._id !== id));
      renderPurchases(purchasesList);
    }
  } catch (err) {
    if (window.Toast) Toast.error('Failed to delete purchase: ' + err.message);
  }
};

/* --- 5. SEARCH, FILTER & SORT --- */
function initFilterAndSortHandlers() {
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const statusSelect = document.getElementById('statusSelect');
  const filterPills = document.querySelectorAll('#categoryFilters .pill');

  let activeCategory = 'all';

  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = pill.getAttribute('data-category');
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', applyFilters);
  sortSelect?.addEventListener('change', applyFilters);
  statusSelect?.addEventListener('change', applyFilters);

  function applyFilters() {
    const query = (searchInput?.value || '').toLowerCase().trim();
    const sortVal = sortSelect?.value || 'newest';
    const statusVal = statusSelect?.value || 'all';

    let filtered = purchasesList.filter(item => {
      const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
      const matchesStatus = statusVal === 'all' || item.status === statusVal;
      
      const s = query;
      const matchesSearch = !s ||
        (item.productName && item.productName.toLowerCase().includes(s)) ||
        (item.brand && item.brand.toLowerCase().includes(s)) ||
        (item.storeName && item.storeName.toLowerCase().includes(s)) ||
        (item.serialNumber && item.serialNumber.toLowerCase().includes(s)) ||
        (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(s));

      return matchesCategory && matchesStatus && matchesSearch;
    });

    if (sortVal === 'oldest') {
      filtered.sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));
    } else if (sortVal === 'price_high') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortVal === 'price_low') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortVal === 'expiry_soon') {
      filtered.sort((a, b) => new Date(a.warrantyExpiresAt) - new Date(b.warrantyExpiresAt));
    } else {
      filtered.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
    }

    renderPurchases(filtered);
  }
}

/* --- 6. ADD PURCHASE FORM MUTATION --- */
function initFormMutations() {
  const form = document.getElementById('addProductForm');
  const saveBtn = document.getElementById('saveProductBtn');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving to MongoDB...';

    const newPurchase = {
      productName: document.getElementById('newProdName').value,
      brand: document.getElementById('newProdBrand').value,
      storeName: document.getElementById('newProdStore').value,
      category: document.getElementById('newProdCategory').value,
      price: parseFloat(document.getElementById('newProdPrice').value) || 0,
      purchaseDate: document.getElementById('newProdDate').value,
      warrantyMonths: parseInt(document.getElementById('newProdWarrantyMonths').value, 10) || 12,
      returnPeriodDays: parseInt(document.getElementById('newProdReturnDays').value, 10) || 30,
      serialNumber: document.getElementById('newProdSerial').value,
      invoiceNumber: document.getElementById('newProdInvoice').value,
      receiptImageUrl: document.getElementById('newProdImg').value,
      notes: document.getElementById('newProdDesc').value
    };

    try {
      const res = await PurchaseApi.createPurchase(newPurchase);
      if (res.success) {
        if (window.Toast) Toast.success(`Saved "${newPurchase.productName}" to MongoDB Vault!`);
        form.reset();
        document.getElementById('addProductModal')?.classList.remove('active');
        await fetchPurchases();
      }
    } catch (err) {
      if (window.Toast) Toast.error(err.message || 'Failed to save purchase');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save to MongoDB Vault';
    }
  });
}

/* --- 7. EXPORT HANDLER --- */
function initExportHandler() {
  document.getElementById('exportInventoryBtn')?.addEventListener('click', () => {
    window.location.href = PurchaseApi.getExportUrl('csv');
    if (window.Toast) Toast.success('Downloading WarrantyVault CSV Export...');
  });
}

function renderSkeletons() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const card = document.createElement('div');
    card.className = 'product-card glass';
    card.style.height = '320px';
    card.innerHTML = `<div class="skeleton-overlay"></div>`;
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* --- 8. SEND WARRANTY REMINDER EMAIL --- */
window.sendWarrantyReminderEmail = async function(id) {
  if (window.Toast) Toast.info('Sending warranty reminder email...');

  try {
    const res = await PurchaseApi.sendWarrantyReminder(id);
    if (res.success) {
      if (window.Toast) Toast.success('Warranty reminder sent successfully.');
    } else {
      if (window.Toast) Toast.error(res.message || 'Unable to send warranty reminder.');
    }
  } catch (err) {
    if (window.Toast) Toast.error('Unable to send warranty reminder: ' + err.message);
  }
};

function formatSummaryBullets(summaryStr) {
  if (!summaryStr) return '';
  const text = String(summaryStr).trim();
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const hasBullets = rawLines.some(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*'));
  const items = (hasBullets || rawLines.length > 1)
    ? rawLines.map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
    : text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);

  const listHtml = items.map(item => {
    const match = item.match(/^([A-Za-z\s\/\-_]+)\s*[:\-]\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      let icon = 'fa-solid fa-circle-dot';
      const keyLower = key.toLowerCase();
      if (keyLower.includes('product') || keyLower.includes('item')) icon = 'fa-solid fa-box';
      else if (keyLower.includes('amount') || keyLower.includes('price') || keyLower.includes('cost')) icon = 'fa-solid fa-tag';
      else if (keyLower.includes('merchant') || keyLower.includes('store') || keyLower.includes('retailer')) icon = 'fa-solid fa-store';
      else if (keyLower.includes('date') || keyLower.includes('purchased')) icon = 'fa-regular fa-calendar-check';
      else if (keyLower.includes('warranty')) icon = 'fa-solid fa-shield-halved';
      else if (keyLower.includes('return')) icon = 'fa-solid fa-clock-rotate-left';
      else if (keyLower.includes('invoice') || keyLower.includes('order')) icon = 'fa-solid fa-receipt';

      return `<li style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
        <i class="${icon}" style="color:#818cf8;margin-top:3px;font-size:0.75rem;flex-shrink:0;"></i>
        <span><strong style="color:#c7d2fe;">${escapeHtml(key)}:</strong> ${escapeHtml(val)}</span>
      </li>`;
    }
    return `<li style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
      <i class="fa-solid fa-circle-dot" style="color:#818cf8;margin-top:3px;font-size:0.75rem;flex-shrink:0;"></i>
      <span>${escapeHtml(item)}</span>
    </li>`;
  }).join('');

  return `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px;">${listHtml}</ul>`;
}

function getProductImageUrl(item) {
  if (!item) return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80';

  // If item has a real uploaded receipt image (and not a generic placeholder)
  if (item.receiptImageUrl && !item.receiptImageUrl.includes('photo-1517336714731-489689fd1ca8')) {
    return item.receiptImageUrl;
  }

  const name = (item.productName || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const brand = (item.brand || '').toLowerCase();

  // 1. Mouse / Peripherals
  if (name.includes('mouse') || name.includes('logitech') || name.includes('trackpad') || name.includes('pointer')) {
    return 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=600&q=80'; // Logitech Mouse
  }

  // 2. Toothbrush / Dental / Personal Grooming
  if (name.includes('toothbrush') || name.includes('sonicare') || name.includes('oral') || name.includes('shaver') || name.includes('groomer')) {
    return 'https://images.unsplash.com/photo-1559591937-e1032b498f82?auto=format&fit=crop&w=600&q=80'; // Electric Toothbrush
  }

  // 3. Bluetooth Speaker / Soundbar
  if (name.includes('speaker') || name.includes('soundlink') || name.includes('bose') || name.includes('soundbar') || name.includes('jbl') || name.includes('audio speaker')) {
    return 'https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=600&q=80'; // Portable Bluetooth Speaker
  }

  // 4. Sunglasses / Eyewear / Glasses
  if (name.includes('sunglass') || name.includes('ray-ban') || name.includes('aviator') || name.includes('eyewear') || name.includes('glasses') || name.includes('spectacles')) {
    return 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=600&q=80'; // Classic Sunglasses
  }

  // 5. Pressure Cooker / Instant Pot / Slow Cooker / Air Fryer
  if (name.includes('cooker') || name.includes('instant pot') || name.includes('pressure') || name.includes('fryer') || name.includes('pot duo') || name.includes('slow cooker')) {
    return 'https://images.unsplash.com/photo-1584990347449-39bbf9b68e92?auto=format&fit=crop&w=600&q=80'; // Pressure Cooker / Kitchen Appliance
  }

  // 6. Vacuum / Dyson / Cleaner
  if (name.includes('vacuum') || name.includes('dyson') || name.includes('cleaner') || name.includes('sweeper')) {
    return 'https://images.unsplash.com/photo-1558317374-067fb5f30001?auto=format&fit=crop&w=600&q=80'; // Cordless Vacuum Cleaner
  }

  // 7. Kindle / E-reader / Book
  if (name.includes('kindle') || name.includes('paperwhite') || name.includes('e-reader') || name.includes('ereader')) {
    return 'https://images.unsplash.com/photo-1592496001020-d31bd830651f?auto=format&fit=crop&w=600&q=80'; // Kindle E-reader
  }

  // 8. Office Chair / Desk Chair / Furniture
  if (name.includes('chair') || name.includes('markus') || name.includes('ergonomic') || name.includes('desk') || name.includes('sofa') || name.includes('table') || cat.includes('furniture')) {
    return 'https://images.unsplash.com/photo-1580480055273-228ff5388ef8?auto=format&fit=crop&w=600&q=80'; // Ergonomic Office Chair
  }

  // 9. Refrigerator / Fridge / Freezer
  if (name.includes('refrigerator') || name.includes('fridge') || name.includes('freezer') || name.includes('frost-free')) {
    return 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=600&q=80'; // Modern Refrigerator
  }

  // 10. Headphones / Over-ear / Earbuds
  if (name.includes('headphone') || name.includes('earphone') || name.includes('earbud') || name.includes('wh-1000') || name.includes('airpod') || name.includes('noise cancelling')) {
    return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'; // Wireless Headphones
  }

  // 11. TV / OLED / Display
  if (name.includes('tv') || name.includes('television') || name.includes('oled') || name.includes('bravia') || name.includes('screen') || name.includes('monitor') || name.includes('crystal 4k')) {
    return 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80'; // 4K OLED Smart TV
  }

  // 12. Blazer / Suit / Jacket / Formal Wear
  if (name.includes('blazer') || name.includes('suit') || name.includes('jacket') || name.includes('coat') || name.includes('tailored')) {
    return 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=600&q=80'; // Tailored Blazer
  }

  // 13. Shoes / Sneakers / Running Footwear
  if (name.includes('shoe') || name.includes('sneaker') || name.includes('boot') || name.includes('pegasus') || name.includes('runner') || name.includes('footwear') || (brand === 'nike' && name.includes('air'))) {
    return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80'; // Running Shoes & Sneakers
  }

  // 14. Coffee / Espresso / Nespresso
  if (name.includes('coffee') || name.includes('espresso') || name.includes('nespresso') || name.includes('vertuo') || name.includes('latte')) {
    return 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?auto=format&fit=crop&w=600&q=80'; // Espresso Coffee Machine
  }

  // 15. Laptop / MacBook / Computer
  if (name.includes('laptop') || name.includes('macbook') || name.includes('notebook') || name.includes('dell') || name.includes('thinkpad')) {
    return 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80'; // Apple MacBook Laptop
  }

  // 16. Groceries / Food / Pantry
  if (name.includes('rice') || name.includes('atta') || name.includes('milk') || name.includes('grocery') || name.includes('groceries') || name.includes('pantry') || name.includes('organic') || cat.includes('food') || cat.includes('grocery')) {
    return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80'; // Fresh Groceries & Food
  }

  // 17. Lamp / Lighting
  if (name.includes('lamp') || name.includes('light') || name.includes('bulb') || name.includes('lantern')) {
    return 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80'; // Table Lamp
  }

  // 18. General Fashion / Shirts / Jeans
  if (name.includes('shirt') || name.includes('jean') || name.includes('pant') || name.includes('dress') || cat.includes('fashion') || cat.includes('apparel')) {
    return 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=600&q=80'; // Fashion Clothing
  }

  // 19. Smartphones / Mobile
  if (name.includes('phone') || name.includes('iphone') || name.includes('galaxy') || name.includes('pixel') || name.includes('mobile')) {
    return 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80'; // Smartphone
  }

  // 20. Smartwatches / Wearables
  if (name.includes('watch') || name.includes('smartwatch') || name.includes('garmin')) {
    return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80'; // Smartwatch
  }

  // 21. Tablets / iPad
  if (name.includes('ipad') || name.includes('tablet')) {
    return 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=600&q=80'; // iPad / Tablet
  }

  return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80';
}

/**
 * Intelligent OCR clutter filter & product title cleaner
 * Removes table numbers, prices, shipping boilerplate, and formats multi-item bills cleanly
 */
function cleanProductTitle(rawName, items = []) {
  if (!rawName && (!items || items.length === 0)) return 'Product';

  // If explicit items array is available, clean and join with commas
  if (Array.isArray(items) && items.length > 0) {
    const cleanItems = items
      .map(it => {
        const n = typeof it === 'string' ? it : (it.name || it.productName || it.item || '');
        return cleanSingleProductName(n);
      })
      .filter(p => p && p !== 'Product');
    if (cleanItems.length > 0) {
      return Array.from(new Set(cleanItems)).join(', ');
    }
  }

  let text = String(rawName || '').trim();

  // Strip delivery, shipping, discount, invoice and payment boilerplate
  text = text.replace(/(?:standard|express|free|cash on)?\s*delivery\s*(?:\([^)]*\)|[0-9\-–\s]+business days)?/gi, '');
  text = text.replace(/shipping\s*(?:charges|fee)?\s*(?:free|[0-9,.]+)?/gi, '');
  text = text.replace(/discount\s*[:\-–]?\s*[0-9,.\-–\s]+/gi, '');
  text = text.replace(/subtotal\s*[:\-–]?\s*[0-9,.]+/gi, '');
  text = text.replace(/total\s*amount\s*[:\-–]?\s*[0-9,.]+/gi, '');
  text = text.replace(/sales\s*receipt\s*[0-9]*/gi, '');
  text = text.replace(/[0-9]+\s+color modes/gi, '');

  // Strip table price noise numbers (e.g., "1 325 325", "2 56 112 x", "1 40 40 oy", "1 3,99 3,990 5", "11,499 1,499")
  text = text.replace(/\b\d+\s+\d{2,}(?:[.,]\d+)?\s+\d{2,}(?:[.,]\d+)?\b/g, ' ');
  text = text.replace(/\b\d+\s+\d{2,}\s+\d{2,}\b/g, ' ');
  text = text.replace(/\b\d{1,2}\s+\d{2,}\s+\d{2,}\b/g, ' ');
  text = text.replace(/\b[0-9]{1,2}\s+[0-9,.]+\s+[0-9,.]+\s+[0-9]\b/g, ' ');
  text = text.replace(/\b[0-9,.]+\s+[0-9,.]+\b/g, ' ');
  text = text.replace(/\b(?:Th|oy|wil|wil\s+A|7s\s+h|7s|s\s+h|x|X|B|F)\b/g, ' ');
  text = text.replace(/\b(Skg)\b/gi, '5kg');
  text = text.replace(/\s{2,}/g, ' ').trim();

  // Known item splits
  const splitKeywords = ['Aashirvaad Atta', 'Fresh Milk', 'Tomatoes', 'Onions', 'Cooking Oil', 'Samsung 25W Charger', 'Wide Leg Jeans'];
  for (const kw of splitKeywords) {
    const regex = new RegExp(`(?<!, )\\b(${kw})`, 'gi');
    text = text.replace(regex, ', $1');
  }

  // Remove leading commas or multiple commas
  text = text.replace(/^[,\s]+/, '').replace(/[,\s]+$/, '');
  
  if (text.includes(',')) {
    const parts = text.split(',')
      .map(p => cleanSingleProductName(p))
      .filter(p => p.length >= 3 && p !== 'Product');
    if (parts.length > 0) {
      return Array.from(new Set(parts)).join(', ');
    }
  }

  return cleanSingleProductName(text);
}

function cleanSingleProductName(str) {
  if (!str) return '';
  let s = String(str).trim();
  s = s.replace(/^[A-Za-z0-9]\s+/, '');
  s = s.replace(/\s+\b(?:wil|wil\s+A|7s\s+h|7s|s\s+h|A|B|C|D|E|F)\b$/gi, '');
  s = s.replace(/\b(?:wil|wil\s+A|7s\s+h|7s|s\s+h)\b/gi, '');
  s = s.replace(/[-–,.:\s]+$/, '');
  s = s.replace(/^[-–,.:\s]+/, '');
  s = s.replace(/\b\d{4,}\b/g, '');
  s = s.replace(/\s+\d{1,2}$/, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s || 'Product';
}