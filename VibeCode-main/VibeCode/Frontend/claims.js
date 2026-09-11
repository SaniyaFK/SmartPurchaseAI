/**
 * AI Warranty Claims Center — WarrantyVault AI (Task 6)
 * File AI-drafted claims, track status (submitted → in_review → approved/rejected),
 * and view the full generated letter. All claims persist to MongoDB.
 */

let allClaims = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
  const user = await RouteGuard.requireAuth('./index.html');
  if (!user) return;

  initThemeEngine();
  initLogoutHandler();
  initCopilot();
  initFilters();
  initNewClaimModal();
  initEmptyState();

  await loadClaims(true);
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

/* --- 4. FILTERS --- */
function initFilters() {
  document.querySelectorAll('#claimStatusFilters .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#claimStatusFilters .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-status');
      renderClaims();
    });
  });
}

/* --- 5. NEW CLAIM MODAL --- */
function initNewClaimModal() {
  const modal = document.getElementById('newClaimModal');
  const openBtn = document.getElementById('openNewClaimBtn');
  const closeBtn = document.getElementById('closeNewClaimBtn');
  const emptyBtn = document.getElementById('emptyStateBtn');

  const openModal = async () => {
    await populatePurchaseSelect();
    modal?.classList.add('active');
  };

  openBtn?.addEventListener('click', openModal);
  emptyBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', () => modal?.classList.remove('active'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  document.getElementById('newClaimForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const purchaseId = document.getElementById('claimPurchaseSelect').value;
    if (!purchaseId) {
      if (window.Toast) Toast.warning('Please select a purchase to claim.');
      return;
    }

    const btn = document.getElementById('fileClaimBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI Drafting Your Letter...';

    try {
      const res = await ClaimApi.createClaim({
        purchaseId,
        issueCategory: document.getElementById('claimIssueCategory').value,
        issueDescription: document.getElementById('claimIssueDescription').value,
        desiredResolution: document.getElementById('claimResolution').value
      });
      if (window.Toast) Toast.success('Claim filed! AI letter generated and saved to MongoDB.');
      modal?.classList.remove('active');
      document.getElementById('newClaimForm').reset();
      await loadClaims(false);
    } catch (err) {
      if (window.Toast) Toast.error('Failed to file claim: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate & File Claim';
    }
  });
}

async function populatePurchaseSelect() {
  const select = document.getElementById('claimPurchaseSelect');
  if (!select) return;
  try {
    const res = await PurchaseApi.getPurchases();
    const purchases = (res && res.data) || [];
    select.innerHTML = purchases.length
      ? purchases.map(p =>
          `<option value="${p.id}">${escapeHtml(p.productName)} — ${escapeHtml(p.storeName || p.merchant || 'Retailer')} (${fmtMoney(p.amount, p.currency)})</option>`
        ).join('')
      : '<option value="">No purchases found — add a purchase first</option>';
  } catch (err) {
    select.innerHTML = '<option value="">Could not load purchases</option>';
  }
}

/* --- 6. EMPTY STATE --- */
function initEmptyState() {
  const emptyBtn = document.getElementById('emptyStateBtn');
  emptyBtn?.addEventListener('click', () => {
    document.getElementById('openNewClaimBtn')?.click();
  });
}

/* --- 7. LOAD CLAIMS --- */
async function loadClaims(showSkeleton = false) {
  const list = document.getElementById('claimsList');
  const empty = document.getElementById('claimsEmptyState');
  if (showSkeleton && list) {
    list.innerHTML = [1, 2, 3].map(() =>
      '<div class="claim-card" style="opacity: 0.6; cursor: default; pointer-events: none;"><div class="claim-card-icon"><i class="fa-solid fa-spinner fa-spin"></i></div><div class="claim-card-body"><div style="height:14px;width:60%;background:rgba(255,255,255,0.1);border-radius:6px;margin-bottom:10px;"></div><div style="height:10px;width:80%;background:rgba(255,255,255,0.07);border-radius:6px;"></div></div></div>'
    ).join('');
  }
  if (empty) empty.style.display = 'none';

  try {
    const res = await ClaimApi.getClaims();
    allClaims = (res && res.data) || [];
    renderClaims();
  } catch (err) {
    if (window.Toast) Toast.error('Failed to load claims: ' + err.message);
    if (list) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>Could not load claims</h3><p>Please try again.</p></div>`;
    }
  }
}

/* --- 8. RENDER --- */
function renderClaims() {
  const list = document.getElementById('claimsList');
  const empty = document.getElementById('claimsEmptyState');
  const badge = document.getElementById('claimsCountBadge');
  if (!list) return;

  let filtered = allClaims;
  if (currentFilter !== 'all') {
    filtered = filtered.filter(c => c.status === currentFilter);
  }

  if (badge) {
    badge.textContent = `${allClaims.length} claim${allClaims.length === 1 ? '' : 's'}${currentFilter !== 'all' ? ` · ${filtered.length} ${currentFilter.replace('_', ' ')}` : ''}`;
  }

  if (filtered.length === 0) {
    list.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      const heading = empty.querySelector('h3');
      if (heading) heading.textContent = allClaims.length === 0 ? 'No Claims Filed Yet' : `No ${currentFilter.replace('_', ' ')} claims`;
    }
    return;
  }

  list.style.display = 'flex';
  if (empty) empty.style.display = 'none';
  list.innerHTML = filtered.map(renderClaimCard).join('');
  attachClaimHandlers();
}

function renderClaimCard(c) {
  const statusLabel = c.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return `
    <div class="claim-card" data-id="${c.id}" data-status="${c.status}">
      <div class="claim-card-icon"><i class="fa-solid fa-file-signature"></i></div>
      <div class="claim-card-body">
        <div class="claim-card-top">
          <span class="claim-product">${escapeHtml(c.productName)}</span>
          <span class="claim-ref">Ref #${c.id.slice(-6).toUpperCase()}</span>
          <span class="claim-status ${c.status}">${statusLabel}</span>
        </div>
        <p class="claim-desc">${escapeHtml(c.issueDescription)}</p>
        <div class="claim-meta">
          <span><i class="fa-solid fa-store"></i> ${escapeHtml(c.storeName || 'Retailer')}</span>
          <span><i class="fa-solid fa-calendar"></i> Filed ${fmtDate(c.submittedAt)}</span>
          <span><i class="fa-solid fa-tag"></i> ${fmtMoney(c.amount, c.currency)}</span>
        </div>
      </div>
      <div class="claim-actions">
        <button class="claim-action-btn view-claim-btn" data-id="${c.id}"><i class="fa-solid fa-eye"></i> View</button>
        <button class="claim-action-btn danger delete-claim-btn" data-id="${c.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `;
}

function attachClaimHandlers() {
  document.querySelectorAll('.view-claim-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openClaimDetail(btn.getAttribute('data-id'));
    });
  });

  document.querySelectorAll('.delete-claim-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (window.UIHelpers) {
        const confirmed = await UIHelpers.confirm({
          title: 'Delete Claim',
          message: 'This will permanently remove the claim record. This cannot be undone.',
          confirmText: 'Delete',
          isDanger: true
        });
        if (!confirmed) return;
      }
      try {
        await ClaimApi.deleteClaim(id);
        if (window.Toast) Toast.success('Claim deleted.');
        allClaims = allClaims.filter(c => c.id !== id);
        renderClaims();
      } catch (err) {
        if (window.Toast) Toast.error('Failed to delete claim: ' + err.message);
      }
    });
  });

  document.querySelectorAll('.claim-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.claim-action-btn')) return;
      openClaimDetail(card.getAttribute('data-id'));
    });
  });
}

/* --- 9. CLAIM DETAIL MODAL --- */
async function openClaimDetail(id) {
  try {
    const res = await ClaimApi.getClaim(id);
    const claim = res.data;
    if (!claim) {
      if (window.Toast) Toast.error('Claim not found.');
      return;
    }
    renderClaimDetail(claim);
    const modal = document.getElementById('claimDetailModal');
    modal?.classList.add('active');
  } catch (err) {
    if (window.Toast) Toast.error('Failed to load claim: ' + err.message);
  }
}

function renderClaimDetail(c) {
  const body = document.getElementById('claimDetailBody');
  if (!body) return;

  const statusLabel = c.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const steps = [
    { status: 'submitted', label: 'Submitted', icon: 'fa-file-signature' },
    { status: 'in_review', label: 'In Review', icon: 'fa-magnifying-glass' },
    { status: 'approved', label: 'Approved', icon: 'fa-circle-check' }
  ];
  const statusIdx = steps.findIndex(s => s.status === c.status);
  const isRejected = c.status === 'rejected';

  const stepperHtml = steps.map((s, i) => {
    let cls = 'claim-step';
    if (isRejected && i >= 1) cls += ' rejected';
    else if (i < statusIdx) cls += ' done';
    else if (i === statusIdx) cls += ' current';
    const arrow = i < steps.length - 1 ? '<i class="fa-solid fa-chevron-right claim-step-arrow"></i>' : '';
    return `<span class="${cls}"><i class="fa-solid ${s.icon}"></i> ${s.label}</span>${arrow}`;
  }).join('');
  if (isRejected) {
    stepperHtml += `<span class="claim-step rejected"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`;
  }

  body.innerHTML = `
    <div class="claim-detail">
      <div class="claim-detail-head">
        <div class="claim-card-icon"><i class="fa-solid fa-file-signature"></i></div>
        <div>
          <div class="claim-detail-title">${escapeHtml(c.productName)}</div>
          <div class="claim-detail-sub">Ref #${c.id.slice(-6).toUpperCase()} · Filed ${fmtDate(c.submittedAt)} · ${escapeHtml(c.storeName || 'Retailer')}</div>
        </div>
      </div>

      <div class="claim-status-stepper">${stepperHtml}</div>

      <div class="claim-detail-grid">
        <div class="claim-detail-item"><label>Status</label><div class="value" style="color: ${statusColor(c.status)};">${statusLabel}</div></div>
        <div class="claim-detail-item"><label>Amount</label><div class="value">${fmtMoney(c.amount, c.currency)}</div></div>
        <div class="claim-detail-item"><label>Serial #</label><div class="value">${escapeHtml(c.serialNumber || 'N/A')}</div></div>
        <div class="claim-detail-item"><label>Invoice #</label><div class="value">${escapeHtml(c.invoiceNumber || 'N/A')}</div></div>
        <div class="claim-detail-item"><label>Purchase Date</label><div class="value">${fmtDate(c.purchaseDate)}</div></div>
        <div class="claim-detail-item"><label>Resolution Requested</label><div class="value">${escapeHtml(c.desiredResolution)}</div></div>
        <div class="claim-detail-item"><label>Issue Category</label><div class="value">${escapeHtml(c.issueCategory)}</div></div>
        <div class="claim-detail-item"><label>Issue Description</label><div class="value">${escapeHtml(c.issueDescription)}</div></div>
      </div>

      <div class="claim-letter-box">
        <div class="claim-letter-title"><i class="fa-solid fa-wand-magic-sparkles"></i> AI-Generated Dispute Letter</div>
        ${escapeHtml(c.letterContent)}
      </div>

      <div class="claim-resolution-note ${c.resolutionNote ? 'show' : ''}" id="claimResolutionNote">
        <i class="fa-solid fa-circle-info"></i> ${escapeHtml(c.resolutionNote)}
      </div>

      <div class="claim-detail-actions" id="claimDetailActions">
        <button class="status-update-btn" data-to="in_review"><i class="fa-solid fa-magnifying-glass"></i> Mark In Review</button>
        <button class="status-update-btn" data-to="approved"><i class="fa-solid fa-circle-check"></i> Approve</button>
        <button class="status-update-btn" data-to="rejected"><i class="fa-solid fa-circle-xmark"></i> Reject</button>
      </div>
    </div>
  `;

  // Status update buttons
  body.querySelectorAll('.status-update-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const to = btn.getAttribute('data-to');
      if (to === 'rejected' && window.UIHelpers) {
        const note = prompt('Reason for rejection (optional):');
        if (note === null) return;
        await updateStatus(c.id, to, note);
        return;
      }
      await updateStatus(c.id, to, '');
    });
  });
}

async function updateStatus(id, status, resolutionNote) {
  try {
    await ClaimApi.updateClaimStatus(id, status, resolutionNote);
    if (window.Toast) Toast.success(`Claim marked as ${status.replace('_', ' ')}.`);
    document.getElementById('claimDetailModal')?.classList.remove('active');
    await loadClaims(false);
  } catch (err) {
    if (window.Toast) Toast.error('Failed to update claim: ' + err.message);
  }
}

/* --- Close detail modal --- */
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('claimDetailModal');
  const closeBtn = document.getElementById('closeClaimDetailBtn');
  closeBtn?.addEventListener('click', () => modal?.classList.remove('active'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });
});

/* --- Helpers --- */
function fmtMoney(value, currency) {
  const symbol = window.getCurrencySymbol ? getCurrencySymbol(currency) : '₹';
  return `${symbol}${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return 'N/A';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusColor(status) {
  const colors = { submitted: '#a78bfa', in_review: '#F59E0B', approved: '#10B981', rejected: '#EF4444' };
  return colors[status] || '#fff';
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
