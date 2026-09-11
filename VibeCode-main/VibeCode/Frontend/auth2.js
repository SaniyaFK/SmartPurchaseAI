import React, { useState } from 'react';
import './styles.css';

export default function AuthPortal() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showPassword, setShowPassword] = useState({
    login: false,
    signup: false,
    confirm: false,
  });

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.body.setAttribute('data-theme', 'dark');
    } else {
      document.body.removeAttribute('data-theme');
    }
  };

  const togglePasswordVisibility = (field) => {
    setShowPassword((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <>
      <button className="theme-toggle-btn" onClick={toggleTheme} type="button">
        <span>{isDarkMode ? '☀️' : '🌙'}</span>
        <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
      </button>

      <div className="geo-container">
        <div class="geo-grid"></div>
        <div className="geo-shape geo-1"></div>
        <div className="geo-shape geo-2"></div>
        <div className="geo-shape geo-3"></div>
        <div className="geo-shape geo-4"></div>
      </div>

      <div className={`card ${isSignUp ? 'signup-mode' : ''}`}>
        {/* Dynamic Panel */}
        <div className="panel-info">
          <div className="panel-geo pg-1"></div>
          <div className="panel-geo pg-2"></div>

          <div className="info-copy for-login">
            <div className="info-content">
              <h2 className="hero-line">Welcome back</h2>
              <p className="sub-line">Good to see you again</p>
              <p className="info-desc">Sign in to pick up right where you left off.</p>
              <button className="ghost-btn" onClick={() => setIsSignUp(true)} type="button">
                Create an account
              </button>
            </div>
          </div>

          <div className="info-copy for-signup">
            <div className="info-content">
              <h2 className="hero-line">Hello there</h2>
              <p className="sub-line">Start your journey</p>
              <p className="info-desc">Takes less than a minute. Bring your ideas — we'll handle the rest.</p>
              <button className="ghost-btn" onClick={() => setIsSignUp(false)} type="button">
                Sign in instead
              </button>
            </div>
          </div>
        </div>

        {/* Forms Panel */}
        <div className="panel-form">
          {/* Sign In Form */}
          <div className="form-wrap login">
            <h1>Sign in</h1>
            <p className="form-sub">Enter your details to access your account.</p>

            <form onSubmit={(e) => e.preventDefault()}>
              <div className="field">
                <label>Email</label>
                <div className="input-wrap">
                  <input type="email" placeholder="you@example.com" required />
                </div>
              </div>

              <div className="field">
                <label>Password</label>
                <div className="input-wrap">
                  <input
                    type={showPassword.login ? 'text' : 'password'}
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    className="toggle-eye"
                    onClick={() => togglePasswordVisibility('login')}
                  >
                    👁
                  </button>
                </div>
              </div>

              <div className="row-between">
                <a href="#forgot" className="link">Forgot password?</a>
              </div>

              <button type="submit" className="submit-btn">Sign in</button>
            </form>
          </div>

          {/* Create Account Form */}
          <div className="form-wrap signup">
            <h1>Create account</h1>
            <p className="form-sub">Let's get your account setup.</p>

            <form onSubmit={(e) => e.preventDefault()}>
              <div className="field">
                <label>Full name</label>
                <div className="input-wrap">
                  <input type="text" placeholder="Jordan Lee" required />
                </div>
              </div>

              <div className="field">
                <label>Date of birth</label>
                <div className="input-wrap">
                  <input type="date" required />
                </div>
              </div>

              <div className="field">
                <label>Email</label>
                <div className="input-wrap">
                  <input type="email" placeholder="you@example.com" required />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Password</label>
                  <div className="input-wrap">
                    <input
                      type={showPassword.signup ? 'text' : 'password'}
                      placeholder="Create password"
                      required
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Confirm</label>
                  <div className="input-wrap">
                    <input
                      type={showPassword.confirm ? 'text' : 'password'}
                      placeholder="Repeat"
                      required
                    />
                  </div>
                </div>
              </div>

              <button type="submit" className="submit-btn" style={{ marginTop: '6px' }}>
                Create account
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}