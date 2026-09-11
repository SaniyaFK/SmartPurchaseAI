document.addEventListener('DOMContentLoaded', async () => {
  // Initialize AI Chatbot floating widget placeholder
  if (window.ChatbotComponent) {
    new window.ChatbotComponent({
      title: 'VibeCode Assistant',
      welcomeMessage: 'Welcome to VibeCode! Log in or create an account to access your workspace.'
    }).init();
  }

  // --- 1. PERSISTENT THEME ENGINE ---
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

  // --- 2. DYNAMIC DOB DROPDOWN GENERATOR ---
  const daySelect = document.getElementById('dobDay');
  const monthSelect = document.getElementById('dobMonth');
  const yearSelect = document.getElementById('dobYear');

  if (daySelect && monthSelect && yearSelect) {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 13; y >= currentYear - 100; y--) {
      yearSelect.add(new Option(y, y));
    }

    function updateDays() {
      const selectedMonth = parseInt(monthSelect.value, 10);
      const selectedYear = parseInt(yearSelect.value, 10);
      const previousSelectedDay = daySelect.value;

      let daysInMonth = 31;
      if (selectedMonth) {
        const yearToTest = selectedYear || 2000;
        daysInMonth = new Date(yearToTest, selectedMonth, 0).getDate();
      }

      daySelect.innerHTML = '<option value="" disabled selected>Day</option>';

      for (let d = 1; d <= daysInMonth; d++) {
        const val = d < 10 ? `0${d}` : `${d}`;
        daySelect.add(new Option(d, val));
      }

      if (previousSelectedDay && parseInt(previousSelectedDay, 10) <= daysInMonth) {
        daySelect.value = previousSelectedDay;
      }
    }

    updateDays();
    monthSelect.addEventListener('change', updateDays);
    yearSelect.addEventListener('change', updateDays);
  }

  // --- 3. LANDING PAGE & VAULT PANEL TRANSITIONS ---
  const card = document.getElementById('card');
  const enterVaultBtn = document.getElementById('enterVaultBtn');
  const getStartedBtn = document.getElementById('getStartedBtn');
  const landingNavSignIn = document.getElementById('landingNavSignIn');
  const backToLandingBtn = document.getElementById('backToLandingBtn');
  const toSignupBtn = document.getElementById('toSignup');
  const toLoginBtn = document.getElementById('toLogin');
  const mobileToggles = document.querySelectorAll('.mobile-toggle');

  function openVault(mode = 'login') {
    if (mode === 'signup') {
      card?.classList.add('signup-mode');
    } else {
      card?.classList.remove('signup-mode');
    }
    document.body.classList.add('in-vault-mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeVaultToLanding() {
    document.body.classList.remove('in-vault-mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  enterVaultBtn?.addEventListener('click', () => openVault('login'));
  landingNavSignIn?.addEventListener('click', () => openVault('login'));
  getStartedBtn?.addEventListener('click', () => openVault('signup'));
  backToLandingBtn?.addEventListener('click', closeVaultToLanding);

  toSignupBtn?.addEventListener('click', () => card?.classList.add('signup-mode'));
  toLoginBtn?.addEventListener('click', () => card?.classList.remove('signup-mode'));

  mobileToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.to === 'signup') {
        card?.classList.add('signup-mode');
      } else {
        card?.classList.remove('signup-mode');
      }
    });
  });

  // URL query parameter routing for direct navigation
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('view') === 'signup' || urlParams.get('mode') === 'signup') {
    openVault('signup');
  } else if (urlParams.get('view') === 'login' || urlParams.get('mode') === 'login') {
    openVault('login');
  }

  // --- 4. EYE TOGGLES ---
  const eyeButtons = document.querySelectorAll('.toggle-eye');
  eyeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-regular fa-eye-slash';
      } else {
        input.type = 'password';
        icon.className = 'fa-regular fa-eye';
      }
    });
  });

  // --- 5. GOOGLE OAUTH BUTTON HANDLER ---
  document.querySelectorAll('.oauth-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.Toast) {
        Toast.info('Google Sign-In ready! Connect GOOGLE_CLIENT_ID in your .env to enable live OAuth authentication.');
      }
    });
  });

  // --- 7. REGEX VALIDATORS ---
  const nameRegex = /^[A-Za-z\s]+$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  function showError(elementId, msg) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
    if (window.Toast) {
      Toast.error(msg);
    }
  }

  function clearError(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function setBtnLoading(btn, isLoading, defaultText) {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
    } else {
      btn.disabled = false;
      btn.innerHTML = defaultText;
    }
  }

  // --- 8. FORM SUBMISSIONS WITH ROLE SUPPORT ---
  const loginForm = document.getElementById('loginFormEl');
  const signupForm = document.getElementById('signupFormEl');

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('loginError');

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    if (!emailRegex.test(email)) {
      return showError('loginError', 'Please enter a valid email address.');
    }
    if (!password) {
      return showError('loginError', 'Password cannot be empty.');
    }

    setBtnLoading(submitBtn, true, 'Sign in');

    try {
      let response;
      if (window.ApiService) {
        response = await ApiService.post('/auth/login', { email, password });
      }

      const userData = (response && response.data && response.data.user) || { email, role: 'user', isLoggedIn: true };
      // Clear any stale auth state from a previous session before writing the new one
      localStorage.removeItem('userSession');
      localStorage.removeItem('vibecode_token');
      localStorage.removeItem('currency');
      sessionStorage.clear();
      if (response && response.data && response.data.token) {
        localStorage.setItem('vibecode_token', response.data.token);
      }
      localStorage.setItem('userSession', JSON.stringify({ ...userData, isLoggedIn: true }));

      if (window.Toast) Toast.success(`Welcome back, ${userData.name || 'User'}! Redirecting...`);
      setTimeout(() => {
        window.location.href = './dashboard.html';
      }, 600);

    } catch (err) {
      setBtnLoading(submitBtn, false, 'Sign in');
      showError('loginError', err.message || 'Authentication failed. Please check your credentials.');
    }
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('signupError');

    const fullName = document.getElementById('fullName').value.trim();
    const day = document.getElementById('dobDay').value;
    const month = document.getElementById('dobMonth').value;
    const year = document.getElementById('dobYear').value;
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn = signupForm.querySelector('button[type="submit"]');

    if (!nameRegex.test(fullName)) {
      return showError('signupError', 'Full name should contain alphabets and spaces only.');
    }
    if (!day || !month || !year) {
      return showError('signupError', 'Please select a complete Date of Birth.');
    }
    if (!emailRegex.test(email)) {
      return showError('signupError', 'Please provide a valid email structure.');
    }
    if (!passwordRegex.test(password)) {
      return showError('signupError', 'Password must be at least 8 characters long, containing 1 uppercase, 1 lowercase, and 1 digit.');
    }
    if (password !== confirmPassword) {
      return showError('signupError', 'Passwords do not match.');
    }

    setBtnLoading(submitBtn, true, 'Create account');

    const dobFormatted = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    try {
      let response;
      if (window.ApiService) {
        response = await ApiService.post('/auth/register', {
          name: fullName,
          email,
          password,
          confirmPassword,
          dob: dobFormatted,
          role: 'user'
        });
      }

      const userData = (response && response.data && response.data.user) || {
        name: fullName,
        dob: dobFormatted,
        email: email,
        role: 'user',
        isLoggedIn: true
      };

      // Clear any stale auth state from a previous session before writing the new one
      localStorage.removeItem('userSession');
      localStorage.removeItem('vibecode_token');
      localStorage.removeItem('currency');
      sessionStorage.clear();
      if (response && response.data && response.data.token) {
        localStorage.setItem('vibecode_token', response.data.token);
      }
      localStorage.setItem('userSession', JSON.stringify({ ...userData, isLoggedIn: true }));

      if (window.Toast) Toast.success(`Account created successfully! Welcome aboard, ${userData.name || 'User'}.`);
      setTimeout(() => {
        window.location.href = './dashboard.html';
      }, 600);

    } catch (err) {
      setBtnLoading(submitBtn, false, 'Create account');
      showError('signupError', err.message || 'Registration failed. Please try again.');
    }
  });
});