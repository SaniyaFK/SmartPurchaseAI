/**
 * Reusable Toast Notification System — VibeCode Starter Architecture
 * Automatically styled and theme-aware for Success, Error, Warning, Info notifications.
 */
class ToastNotification {
  constructor() {
    this.container = null;
    this.initContainer();
  }

  initContainer() {
    if (document.getElementById('toast-container')) {
      this.container = document.getElementById('toast-container');
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 380px;
      width: calc(100% - 48px);
      pointer-events: none;
    `;
    document.body.appendChild(this.container);

    // Inject Toast CSS styles if not present
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        .vibecode-toast {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-radius: 12px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 0.9rem;
          font-weight: 500;
          color: #ffffff;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          animation: toastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transition: all 0.3s ease;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .vibecode-toast.hide {
          animation: toastSlideOut 0.3s cubic-bezier(0.7, 0, 0.84, 0) forwards;
        }
        .vibecode-toast-success {
          background: rgba(16, 185, 129, 0.9);
        }
        .vibecode-toast-error {
          background: rgba(239, 68, 68, 0.9);
        }
        .vibecode-toast-warning {
          background: rgba(245, 158, 11, 0.9);
          color: #1a1a1a;
        }
        .vibecode-toast-info {
          background: rgba(59, 130, 246, 0.9);
        }
        .vibecode-toast-icon {
          font-size: 1.1rem;
          flex-shrink: 0;
        }
        .vibecode-toast-message {
          flex-grow: 1;
          line-height: 1.4;
        }
        .vibecode-toast-close {
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          opacity: 0.7;
          font-size: 1rem;
          padding: 0 4px;
        }
        .vibecode-toast-close:hover {
          opacity: 1;
        }
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastSlideOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-20px) scale(0.95); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  show(message, type = 'info', duration = 4000) {
    this.initContainer();

    const toast = document.createElement('div');
    toast.className = `vibecode-toast vibecode-toast-${type}`;

    const icons = {
      success: 'fa-solid fa-circle-check',
      error: 'fa-solid fa-circle-xmark',
      warning: 'fa-solid fa-triangle-exclamation',
      info: 'fa-solid fa-circle-info'
    };

    toast.innerHTML = `
      <i class="${icons[type] || icons.info} vibecode-toast-icon"></i>
      <span class="vibecode-toast-message">${message}</span>
      <button class="vibecode-toast-close" type="button">&times;</button>
    `;

    const closeBtn = toast.querySelector('.vibecode-toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toast));

    this.container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }

    return toast;
  }

  dismiss(toast) {
    if (!toast || toast.classList.contains('hide')) return;
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  success(msg, duration) { return this.show(msg, 'success', duration); }
  error(msg, duration) { return this.show(msg, 'error', duration); }
  warning(msg, duration) { return this.show(msg, 'warning', duration); }
  info(msg, duration) { return this.show(msg, 'info', duration); }
}

window.Toast = new ToastNotification();
