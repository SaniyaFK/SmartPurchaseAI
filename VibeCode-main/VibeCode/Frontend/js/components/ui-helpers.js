/**
 * Reusable UI Helpers & Components — VibeCode Starter Architecture
 * Modal Confirmation, Empty States, Skeletons, Error/Retry UI, Search Debouncing & Pagination.
 */
class UIHelpers {
  /**
   * Confirmation Dialog Modal
   */
  static confirm({
    title = 'Are you sure?',
    message = 'This action cannot be undone.',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDanger = false
  }) {
    return new Promise((resolve) => {
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'vibecode-modal-overlay';
      modalOverlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        animation: fadeIn 0.2s ease forwards;
      `;

      const confirmBg = isDanger ? '#ef4444' : '#6366f1';

      modalOverlay.innerHTML = `
        <div style="
          background: var(--card-bg, #1e1e2e);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          padding: 24px;
          max-width: 420px;
          width: 100%;
          color: var(--text-color, #fff);
          font-family: 'Plus Jakarta Sans', sans-serif;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        ">
          <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 1.2rem;">${title}</h3>
          <p style="margin-bottom: 24px; color: #a1a1aa; font-size: 0.9rem; line-height: 1.5;">${message}</p>
          <div style="display: flex; justify-content: flex-end; gap: 12px;">
            <button id="vibecode-modal-cancel" style="
              background: rgba(255, 255, 255, 0.08);
              color: #fff;
              border: 1px solid rgba(255, 255, 255, 0.1);
              padding: 10px 18px;
              border-radius: 10px;
              cursor: pointer;
              font-weight: 500;
            ">${cancelText}</button>
            <button id="vibecode-modal-confirm" style="
              background: ${confirmBg};
              color: #fff;
              border: none;
              padding: 10px 18px;
              border-radius: 10px;
              cursor: pointer;
              font-weight: 600;
            ">${confirmText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modalOverlay);

      const cancelBtn = modalOverlay.querySelector('#vibecode-modal-cancel');
      const confirmBtn = modalOverlay.querySelector('#vibecode-modal-confirm');

      const cleanup = (result) => {
        modalOverlay.remove();
        resolve(result);
      };

      cancelBtn.addEventListener('click', () => cleanup(false));
      confirmBtn.addEventListener('click', () => cleanup(true));
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) cleanup(false);
      });
    });
  }

  /**
   * Debounce search input
   */
  static debounce(func, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => func.apply(this, args), delay);
    };
  }

  /**
   * Client-side pagination helper
   */
  static paginate(items = [], page = 1, pageSize = 10) {
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);

    return {
      items: items.slice(startIndex, endIndex),
      page: currentPage,
      pageSize,
      totalItems,
      totalPages
    };
  }

  /**
   * Skeleton loader generator
   */
  static createSkeleton(width = '100%', height = '20px', borderRadius = '8px') {
    const skeleton = document.createElement('div');
    skeleton.className = 'vibecode-skeleton-loader';
    skeleton.style.cssText = `
      width: ${width};
      height: ${height};
      border-radius: ${borderRadius};
      background: linear-gradient(90deg, rgba(255, 255, 255, 0.05) 25%, rgba(255, 255, 255, 0.12) 50%, rgba(255, 255, 255, 0.05) 75%);
      background-size: 200% 100%;
      animation: vibecodeSkeletonShimmer 1.5s infinite;
    `;

    if (!document.getElementById('skeleton-styles')) {
      const style = document.createElement('style');
      style.id = 'skeleton-styles';
      style.textContent = `
        @keyframes vibecodeSkeletonShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `;
      document.head.appendChild(style);
    }

    return skeleton;
  }

  /**
   * Empty state container builder
   */
  static createEmptyState({
    icon = 'fa-folder-open',
    title = 'No Data Available',
    message = 'There are no items to display at this time.',
    actionText = null,
    onAction = null
  }) {
    const container = document.createElement('div');
    container.className = 'vibecode-empty-state';
    container.style.cssText = `
      text-align: center;
      padding: 48px 24px;
      color: #a1a1aa;
      font-family: 'Plus Jakarta Sans', sans-serif;
    `;

    container.innerHTML = `
      <i class="fa-solid ${icon}" style="font-size: 3rem; color: #6366f1; margin-bottom: 16px; opacity: 0.8;"></i>
      <h3 style="margin-top: 0; margin-bottom: 8px; color: #fff; font-size: 1.1rem;">${title}</h3>
      <p style="margin-bottom: 20px; font-size: 0.9rem; max-width: 360px; margin-left: auto; margin-right: auto;">${message}</p>
      ${actionText ? `<button class="vibecode-empty-action-btn" style="
        background: #6366f1;
        color: #fff;
        border: none;
        padding: 10px 20px;
        border-radius: 10px;
        font-weight: 600;
        cursor: pointer;
      ">${actionText}</button>` : ''}
    `;

    if (actionText && onAction) {
      const btn = container.querySelector('.vibecode-empty-action-btn');
      btn?.addEventListener('click', onAction);
    }

    return container;
  }

  /**
   * Error state with retry container builder
   */
  static createErrorState({
    title = 'Something went wrong',
    message = 'Failed to load content from server.',
    onRetry = null
  }) {
    const container = document.createElement('div');
    container.style.cssText = `
      text-align: center;
      padding: 36px 20px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 14px;
      color: #f87171;
      font-family: 'Plus Jakarta Sans', sans-serif;
    `;

    container.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; margin-bottom: 12px;"></i>
      <h4 style="margin-top: 0; margin-bottom: 6px; color: #fca5a5;">${title}</h4>
      <p style="margin-bottom: 16px; font-size: 0.88rem; color: #f87171;">${message}</p>
      ${onRetry ? `<button class="vibecode-retry-btn" style="
        background: #ef4444;
        color: #fff;
        border: none;
        padding: 8px 18px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
      "><i class="fa-solid fa-rotate-right"></i> Retry</button>` : ''}
    `;

    if (onRetry) {
      container.querySelector('.vibecode-retry-btn')?.addEventListener('click', onRetry);
    }

    return container;
  }
}

window.UIHelpers = UIHelpers;
