document.addEventListener('DOMContentLoaded', async () => {
  if (window.RouteGuard) {
    await RouteGuard.checkAuth();
  }
  const appLayout = document.querySelector('.app-layout');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const mobileSidebarToggle = document.getElementById('mobileSidebarToggle');

  // Sidebar Collapse State Logic
  const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (isCollapsed) {
    appLayout?.classList.add('sidebar-collapsed');
  }

  sidebarToggle?.addEventListener('click', () => {
    appLayout?.classList.toggle('sidebar-collapsed');
    const collapsed = appLayout?.classList.contains('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed);
  });

  mobileSidebarToggle?.addEventListener('click', () => {
    appLayout?.classList.toggle('mobile-open');
  });

  // Purchase Copilot nav button opens the AI chatbot widget
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

  // Theme Toggle Logic
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
    if (theme === 'dark') {
      if (themeIcon) themeIcon.className = 'fa-solid fa-moon';
      if (themeLabel) themeLabel.textContent = 'Dark Theme';
    } else {
      if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
      if (themeLabel) themeLabel.textContent = 'Light Theme';
    }
  }

  // Form Validation & Feedback
  const contactForm = document.getElementById('contactForm');
  const feedbackEl = document.getElementById('contactFeedback');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  contactForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('contactName').value.trim();
    const email = document.getElementById('contactEmail').value.trim();
    const subject = document.getElementById('contactSubject').value.trim();
    const message = document.getElementById('contactMessage').value.trim();

    if (!name) return showFeedback('Please enter your full name.', true);
    if (!emailRegex.test(email)) return showFeedback('Please enter a valid email address.', true);
    if (!subject) return showFeedback('Please enter a subject.', true);
    if (!message) return showFeedback('Please enter your message.', true);

    showFeedback('Thank you! Your message has been sent successfully.', false);
    contactForm.reset();
  });

  function showFeedback(msg, isError) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg;
    feedbackEl.style.display = 'block';
    feedbackEl.style.padding = '10px 14px';
    feedbackEl.style.borderRadius = '6px';
    feedbackEl.style.fontSize = '13px';
    feedbackEl.style.border = '1px solid';

    if (isError) {
      feedbackEl.style.background = 'rgba(239, 68, 68, 0.12)';
      feedbackEl.style.borderColor = '#EF4444';
      feedbackEl.style.color = '#F87171';
    } else {
      feedbackEl.style.background = 'rgba(34, 197, 94, 0.12)';
      feedbackEl.style.borderColor = '#22C55E';
      feedbackEl.style.color = '#4ADE80';
    }
  }

  // Remove skeleton loader once iframe map loads
  const mapIframe = document.getElementById('mapIframe');
  const hideSkeleton = () => document.body.classList.remove('loading');

  if (mapIframe) {
    mapIframe.addEventListener('load', hideSkeleton);
  }
  window.addEventListener('load', hideSkeleton);
  setTimeout(hideSkeleton, 2000);
});