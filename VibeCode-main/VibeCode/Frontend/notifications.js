/**
 * Notification Center — WarrantyVault AI
 * Dedicated notifications section backed by the per-user Notification API.
 */

let allNotifications = [];
let currentFilter = 'all';

const TYPE_META = {
  RETURN_DEADLINE_ALERT: { icon: 'fa-triangle-exclamation', label: 'Return Deadline' },
  WARRANTY_EXPIRY_ALERT: { icon: 'fa-shield-halved', label: 'Warranty Expiry' },
  CLAIM_UPDATE: { icon: 'fa-file-pen', label: 'Claim Update' },
  SPENDING_ALERT: { icon: 'fa-wallet', label: 'Spending Alert' },
  SYSTEM: { icon: 'fa-bell', label: 'System' }
};

document.addEventListener('DOMContentLoaded', async () => {
  const user = await RouteGuard.requireAuth('./index.html');
  if (!user) return;

  initThemeEngine();
  initLogoutHandler();
  initProfilePill();
  initCopilot();
  initTabs();
  initActions();
  checkDatabaseStatus();

  await loadNotifications(true);
});

/* --- 1. THEME ENGINE (shared with dashboard) --- */
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

/* --- 2. LOGOUT --- */
function initLogoutHandler() {
  const btn = document.getElementById('sidebarLogoutBtn');
  btn?.addEventListener('click', async (e) => {
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

/* --- 3. PROFILE PILL → profile page --- */
function initProfilePill() {
  document.getElementById('profilePillBtn')?.addEventListener('click', () => {
    window.location.href = 'profile.html';
  });
}

/* --- 4. COPILOT NAV BUTTON opens chatbot widget --- */
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

/* --- 5. TABS --- */
function initTabs() {
  document.querySelectorAll('.notif-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.getAttribute('data-filter');
      renderNotifications();
    });
  });
}

/* --- 6. ACTIONS --- */
function initActions() {
  document.getElementById('markAllReadBtn')?.addEventListener('click', async () => {
    try {
      await NotificationApi.markAllAsRead();
      allNotifications = allNotifications.map(n => ({ ...n, isRead: true }));
      renderNotifications();
      if (window.Toast) Toast.success('All notifications marked as read.');
    } catch (err) {
      if (window.Toast) Toast.error('Failed to mark all as read: ' + err.message);
    }
  });

  document.getElementById('refreshNotifBtn')?.addEventListener('click', () => loadNotifications(true));
  document.getElementById('emptySeedBtn')?.addEventListener('click', () => loadNotifications(true));
}

/* --- 7. LOAD NOTIFICATIONS --- */
async function loadNotifications(showSkeleton = false) {
  const skeleton = document.getElementById('notifSkeleton');
  const list = document.getElementById('notifList');
  const empty = document.getElementById('notifEmpty');
  if (showSkeleton && skeleton) skeleton.style.display = 'flex';
  if (list) list.style.display = 'none';
  if (empty) empty.style.display = 'none';

  try {
    // Refresh alerts from live purchase data first, then fetch
    await NotificationApi.seedNotifications().catch(() => {});
    const res = await NotificationApi.getNotifications();
    allNotifications = (res && res.data) || [];
    renderNotifications();
  } catch (err) {
    if (window.Toast) Toast.error('Failed to load notifications: ' + err.message);
    if (list) {
      list.style.display = 'block';
      list.innerHTML = `<div class="notif-empty"><p>Could not load notifications. Please try again.</p></div>`;
    }
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    if (list) list.style.display = 'block';
  }
}

/* --- 8. RENDER --- */
function renderNotifications() {
  const list = document.getElementById('notifList');
  const empty = document.getElementById('notifEmpty');
  if (!list) return;

  const unreadCount = allNotifications.filter(n => !n.isRead).length;
  document.getElementById('tabCountAll').textContent = allNotifications.length;
  document.getElementById('tabCountUnread').textContent = unreadCount;

  // Update bell badge in the top header if present
  const badge = document.getElementById('urgentAlertBadge');
  if (badge) {
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? 'flex' : 'none';
  }

  let filtered = allNotifications;
  if (currentFilter === 'unread') filtered = filtered.filter(n => !n.isRead);
  else if (currentFilter !== 'all') filtered = filtered.filter(n => n.type === currentFilter);

  if (filtered.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  list.innerHTML = filtered.map(n => renderNotificationCard(n)).join('');
  attachCardHandlers();
}

function renderNotificationCard(n) {
  const meta = TYPE_META[n.type] || TYPE_META.SYSTEM;
  const timeAgo = timeAgoStr(n.createdAt);
  const dueText = n.dueDate
    ? `Due: ${new Date(n.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  return `
    <div class="notif-card ${n.isRead ? '' : 'unread'} urgency-${n.urgency || 'INFO'}" data-id="${n.id}" data-read="${n.isRead ? '1' : '0'}">
      <div class="notif-card-icon ${n.type}"><i class="fa-solid ${meta.icon}"></i></div>
      <div class="notif-card-body">
        <div class="notif-card-title-row">
          <span class="notif-card-title">${escapeHtml(n.title)}</span>
          <span class="notif-card-time">${timeAgo}</span>
        </div>
        <p class="notif-card-message">${escapeHtml(n.message)}</p>
        <div class="notif-card-meta">
          <span class="urgency-badge ${n.urgency || 'INFO'}">${n.urgency || 'INFO'}</span>
          <span class="type-badge"><i class="fa-solid ${meta.icon}"></i> ${meta.label}</span>
          ${dueText ? `<span class="due-date-chip"><i class="fa-regular fa-calendar"></i> ${dueText}</span>` : ''}
        </div>
      </div>
      <div class="notif-card-actions">
        <button class="read-toggle-btn ${n.isRead ? 'marked' : ''}" title="${n.isRead ? 'Mark as unread' : 'Mark as read'}">
          <i class="fa-solid ${n.isRead ? 'fa-circle-check' : 'fa-circle'}"></i>
        </button>
      </div>
    </div>
  `;
}

function attachCardHandlers() {
  document.querySelectorAll('.notif-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const toggleBtn = card.querySelector('.read-toggle-btn');
    toggleBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const notif = allNotifications.find(n => n.id === id || n._id === id);
      if (!notif) return;

      if (notif.isRead) {
        // Toggle back to unread locally (API marks read only)
        notif.isRead = false;
        renderNotifications();
        return;
      }

      try {
        await NotificationApi.markAsRead(id);
        notif.isRead = true;
        renderNotifications();
      } catch (err) {
        if (window.Toast) Toast.error('Failed to update notification: ' + err.message);
      }
    });
  });
}

/* --- 9. DB STATUS PILL --- */
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

/* --- Helpers --- */
function timeAgoStr(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
