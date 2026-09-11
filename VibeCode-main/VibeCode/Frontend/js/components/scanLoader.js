/**
 * AI Receipt Scanning Animated Progress & Holographic Loader
 * Renders an aesthetic holographic scanner overlay with dynamic AI progress steps.
 * Freezes the background and centers the loader card with maximum visibility.
 */
'use strict';

class AiScanLoader {
  static _overlayEl = null;
  static _intervalId = null;
  static _currentStepIndex = 0;

  static _steps = [
    { text: 'Normalizing image contrast & geometry...', progress: 20, dot: 0 },
    { text: 'Extracting text with OCR engine...', progress: 45, dot: 1 },
    { text: 'Identifying store, product, amount & date...', progress: 70, dot: 2 },
    { text: 'Detecting warranty duration & return policy...', progress: 88, dot: 3 },
    { text: 'Running duplicate & anomaly validation...', progress: 96, dot: 4 }
  ];

  static _ensureDom() {
    let overlay = document.getElementById('aiScanLoadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'aiScanLoadingOverlay';
      overlay.className = 'ai-scan-loading-overlay';
      overlay.style.display = 'none';
      overlay.innerHTML = `
        <div class="ai-scan-loading-card">
          <!-- Holographic Document Scanner Graphic -->
          <div class="scan-animation-wrapper">
            <div class="doc-skeleton-line head"></div>
            <div class="doc-skeleton-line short"></div>
            <div class="doc-skeleton-line mid"></div>
            <div class="doc-skeleton-line full"></div>
            <div class="doc-skeleton-line price"></div>
            <div class="scan-laser-beam"></div>
          </div>

          <!-- Header & Engine Badge -->
          <div class="scan-loading-badge">
            <i class="fa-solid fa-wand-magic-sparkles"></i> AI Receipt Scanner Active
          </div>

          <h3 class="scan-loading-title">Scanning Receipt...</h3>
          <div class="scan-loading-file" id="scanLoadingFileName">Processing Document</div>

          <!-- Dynamic Status Text -->
          <div class="scan-live-step-text" id="scanLoadingStepText">Normalizing image contrast &amp; geometry...</div>

          <!-- Progress Bar -->
          <div class="scan-progress-track">
            <div class="scan-progress-bar" id="scanLoadingProgressBar" style="width: 20%;"></div>
          </div>

          <!-- Progress Percentage -->
          <div class="scan-percent-text" id="scanLoadingPercent">20%</div>

          <!-- 5 Step Dots -->
          <div class="scan-steps-dots">
            <div class="scan-step-dot active" data-step="0"></div>
            <div class="scan-step-dot" data-step="1"></div>
            <div class="scan-step-dot" data-step="2"></div>
            <div class="scan-step-dot" data-step="3"></div>
            <div class="scan-step-dot" data-step="4"></div>
          </div>

          <!-- Page Freeze Notice -->
          <p class="scan-freeze-notice"><i class="fa-solid fa-lock"></i> Page is locked while AI securely extracts purchase data</p>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    this._overlayEl = overlay;
  }

  /**
   * Show the holographic scanning loader and freeze the page
   * @param {string} fileName - Name of the receipt file or sample being analyzed
   */
  static show(fileName = 'Receipt Document') {
    this._ensureDom();
    if (this._intervalId) clearInterval(this._intervalId);

    const nameEl = document.getElementById('scanLoadingFileName');
    const stepEl = document.getElementById('scanLoadingStepText');
    const barEl = document.getElementById('scanLoadingProgressBar');
    const pctEl = document.getElementById('scanLoadingPercent');
    
    if (nameEl) nameEl.textContent = fileName || 'Receipt Document';
    if (stepEl) stepEl.textContent = this._steps[0].text;
    if (barEl) barEl.style.width = `${this._steps[0].progress}%`;
    if (pctEl) pctEl.textContent = `${this._steps[0].progress}%`;

    this._updateDots(0);
    this._currentStepIndex = 0;

    // Freeze page scrolling & user interactions
    try {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } catch(e) {}

    this._overlayEl.style.display = 'flex';
    // Force reflow for smooth animation transition
    void this._overlayEl.offsetWidth;
    this._overlayEl.classList.add('active');

    // Progression timer to advance steps while waiting for network/OCR completion
    this._intervalId = setInterval(() => {
      if (this._currentStepIndex < this._steps.length - 1) {
        this._currentStepIndex++;
        const current = this._steps[this._currentStepIndex];
        if (stepEl) {
          stepEl.style.opacity = '0';
          setTimeout(() => {
            stepEl.textContent = current.text;
            stepEl.style.opacity = '1';
          }, 150);
        }
        if (barEl) barEl.style.width = `${current.progress}%`;
        if (pctEl) pctEl.textContent = `${current.progress}%`;
        this._updateDots(current.dot);
      }
    }, 750);
  }

  static _updateDots(activeDotIndex) {
    const dots = document.querySelectorAll('.scan-step-dot');
    dots.forEach((d, idx) => {
      if (idx < activeDotIndex) {
        d.className = 'scan-step-dot done';
      } else if (idx === activeDotIndex) {
        d.className = 'scan-step-dot active';
      } else {
        d.className = 'scan-step-dot';
      }
    });
  }

  /**
   * Hide the holographic scanning loader and unfreeze the page
   */
  static hide() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }

    const barEl = document.getElementById('scanLoadingProgressBar');
    const stepEl = document.getElementById('scanLoadingStepText');
    const pctEl = document.getElementById('scanLoadingPercent');
    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (stepEl) stepEl.textContent = '✨ Extraction Complete!';
    this._updateDots(5);

    setTimeout(() => {
      // Unfreeze page scrolling
      try {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      } catch(e) {}

      if (this._overlayEl) {
        this._overlayEl.classList.remove('active');
        setTimeout(() => {
          if (!this._overlayEl.classList.contains('active')) {
            this._overlayEl.style.display = 'none';
          }
        }, 300);
      }
    }, 350);
  }
}

// Attach to window
window.AiScanLoader = AiScanLoader;

// Initialize on DOM ready if possible
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AiScanLoader._ensureDom());
  } else {
    AiScanLoader._ensureDom();
  }
}
