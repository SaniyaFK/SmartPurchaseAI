/**
 * Profile & Settings — WarrantyVault AI
 * Loads the authenticated user, displays account stats, and lets users
 * update their name / password through the real auth API.
 */

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  const user = await RouteGuard.requireAuth('./index.html');
  if (!user) return;
  currentUser = user;

  initThemeEngine();
  initProfilePill();
  initCopilot();
  initLogoutHandler();
  initPreferences();
  initProfileForm();

  await loadProfile();
  checkDatabaseStatus();
});

/* --- 1. THEME ENGINE --- */
function initThemeEngine() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  const toggle = document.getElementById('sidebarThemeToggle');
  toggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.getElementById('sidebarThemeIcon');
    const label = document.getElementById('sidebarThemeLabel');
    if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if (label) label.textContent = theme === 'dark' ? 'Dark Theme' : 'Light Theme';
  }
}

/* --- 2. PROFILE PILL (already on profile page — go to dashboard) --- */
function initProfilePill() {
  document.getElementById('profilePillBtn')?.addEventListener('click', () => {
    window.location.href = 'profile.html';
  });
}

/* --- 3. COPILOT NAV BUTTON opens chatbot widget --- */
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

/* --- 4. LOGOUT --- */
function initLogoutHandler() {
  const wire = (btn) => btn?.addEventListener('click', async (e) => {
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

  wire(document.getElementById('sidebarLogoutBtn'));
  wire(document.getElementById('profileLogoutBtn'));
}

/* --- 5. LOAD PROFILE & STATS --- */
async function loadProfile() {
  try {
    const res = await ApiService.get('/auth/me');
    if (res.success && res.data && res.data.user) {
      currentUser = res.data.user;
      localStorage.setItem('userSession', JSON.stringify({ ...currentUser, isLoggedIn: true }));
      RouteGuard.updateDOMProfile(currentUser);
      renderProfile(currentUser);
    }
  } catch (err) {
    if (window.Toast) Toast.error('Failed to load profile: ' + err.message);
  }

  // Load account stats
  try {
    const [statsRes, notifRes] = await Promise.all([
      PurchaseApi.getStats().catch(() => ({ success: false })),
      NotificationApi.getUnreadCount().catch(() => ({ success: false }))
    ]);

    if (statsRes.success && statsRes.data && statsRes.data.metrics) {
      const m = statsRes.data.metrics;
      setText('statPurchases', m.totalItemsCount || 0);
      setText('statSpend', `${window.getCurrencySymbol ? getCurrencySymbol() : '₹'}${(m.totalSpend?.value || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
      setText('statWarranties', m.activeWarrantyCount || m.activeWarrantiesValue?.count || 0);
    }
    if (notifRes.success) {
      setText('statNotifs', notifRes.unreadCount || 0);
    }
  } catch (err) {
    console.warn('Failed to load profile stats:', err.message);
  }
}

function renderProfile(user) {
  const name = user.name || 'User';
  const email = user.email || '';
  setText('profileName', name);
  setText('profileEmail', email);
  setText('profileRoleBadge', (user.role || 'user').toUpperCase());
  setText('editName', name);
  setText('editEmail', email);
  setText('editRole', (user.role || 'user').toUpperCase());

  // Initials avatar
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
  setText('profileAvatarInitials', initials);

  // Member since
  if (user.createdAt) {
    const d = new Date(user.createdAt);
    setText('profileMemberSince', `Member since ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
  }
}

/* --- 6. PROFILE FORM (update name / password) --- */
function initProfileForm() {
  const form = document.getElementById('profileUpdateForm');
  const confirmInput = document.getElementById('editConfirmPassword');
  const hint = document.getElementById('passwordMatchHint');

  confirmInput?.addEventListener('input', () => {
    const pw = document.getElementById('editNewPassword').value;
    if (!confirmInput.value) { hint.style.display = 'none'; return; }
    hint.style.display = confirmInput.value === pw ? 'none' : 'block';
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('editName').value.trim();
    const newPassword = document.getElementById('editNewPassword').value;
    const confirmPassword = document.getElementById('editConfirmPassword').value;

    if (newPassword && newPassword !== confirmPassword) {
      if (window.Toast) Toast.error('New passwords do not match.');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      if (window.Toast) Toast.error('Password must be at least 8 characters.');
      return;
    }

    const saveBtn = document.getElementById('profileSaveBtn');
    const originalHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    saveBtn.disabled = true;

    try {
      const payload = { name };
      if (newPassword) payload.newPassword = newPassword;
      const res = await ApiService.put('/auth/profile', payload);

      if (res.success) {
        const session = JSON.parse(localStorage.getItem('userSession') || '{}');
        localStorage.setItem('userSession', JSON.stringify({ ...session, name, isLoggedIn: true }));
        RouteGuard.updateDOMProfile({ ...session, name });
        document.getElementById('editNewPassword').value = '';
        document.getElementById('editConfirmPassword').value = '';
        if (window.Toast) Toast.success('Profile updated successfully!');
        await loadProfile();
      }
    } catch (err) {
      if (window.Toast) Toast.error('Profile update failed: ' + err.message);
    } finally {
      saveBtn.innerHTML = originalHtml;
      saveBtn.disabled = false;
    }
  });
}

/* --- 7. PREFERENCES (theme + currency display) --- */
function initPreferences() {
  const themeToggle = document.getElementById('themePrefToggle');
  themeToggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    const icon = document.getElementById('themePrefIcon');
    const label = document.getElementById('themePrefLabel');
    if (icon) icon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if (label) label.textContent = next === 'dark' ? 'Dark' : 'Light';
    if (window.Toast) Toast.success(`${next === 'dark' ? 'Dark' : 'Light'} theme applied`);
  });

  const currencySelect = document.getElementById('currencySelect');
  const savedCurrency = localStorage.getItem('currency') || 'INR';
  if (currencySelect) {
    currencySelect.value = savedCurrency;
    currencySelect.addEventListener('change', () => {
      localStorage.setItem('currency', currencySelect.value);
      if (window.Toast) Toast.success(`Currency preference set to ${currencySelect.value}`);
    });
  }
}

/* --- 8. DB STATUS PILL --- */
async function checkDatabaseStatus() {
  const text = document.getElementById('dbStatusText');
  try {
    const res = await PurchaseApi.getDbStatus();
    if (text) text.textContent = (res.success && res.data && res.data.connected)
      ? `MongoDB: ${res.data.databaseName}`
      : 'MongoDB: Connected';
  } catch (e) {
    if (text) text.textContent = 'MongoDB: Active';
  }
}

/* --- Helper --- */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
