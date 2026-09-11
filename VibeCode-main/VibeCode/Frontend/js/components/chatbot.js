/**
 * AI Financial & Warranty Copilot Component — WarrantyVault AI
 * Conversational Assistant providing real-time advice on purchases,
 * upcoming return deadlines, warranty expirations, and claim assistance.
 */
class ChatbotComponent {
  constructor(options = {}) {
    this.containerId = options.containerId || 'vibecode-chatbot-container';
    this.title = options.title || 'Warranty & Spend Copilot';
    this.welcomeMessage = options.welcomeMessage || 'Hi! I am your AI Purchase & Warranty Assistant. Ask me about your return deadlines, warranty expirations, or spending insights!';
    this.onSendMessage = options.onSendMessage || this.handleAiCopilotQuery;
    this.isOpen = false;
    this.sessionId = localStorage.getItem('warrantyvault_rag_session_id') || null;
  }

  async init() {
    if (document.getElementById(this.containerId)) return;
    this.injectStyles();
    this.render();
    await this.loadChatHistory();
    this.loadDataSuggestions();
  }

  /**
   * Restore previous chat messages from server or localStorage on page load/refresh
   */
  async loadChatHistory() {
    const list = document.getElementById('vibecode-chat-msg-list');
    if (!list) return;

    let loadedSession = null;

    try {
      if (window.ChatApi) {
        if (this.sessionId) {
          const res = await window.ChatApi.getSession(this.sessionId).catch(() => null);
          if (res && res.success && res.data && Array.isArray(res.data.messages) && res.data.messages.length > 0) {
            loadedSession = res.data;
          }
        }

        // If no stored session or stored session empty, look for the most recent session
        if (!loadedSession) {
          const listRes = await window.ChatApi.getSessions().catch(() => null);
          if (listRes && listRes.success && Array.isArray(listRes.data) && listRes.data.length > 0) {
            const latest = listRes.data[0];
            const fullRes = await window.ChatApi.getSession(latest.sessionId).catch(() => null);
            if (fullRes && fullRes.success && fullRes.data && Array.isArray(fullRes.data.messages) && fullRes.data.messages.length > 0) {
              loadedSession = fullRes.data;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Chatbot] History restoration notice:', e.message);
    }

    // Render loaded messages if found
    if (loadedSession && Array.isArray(loadedSession.messages) && loadedSession.messages.length > 0) {
      this.sessionId = loadedSession.sessionId;
      localStorage.setItem('warrantyvault_rag_session_id', this.sessionId);
      list.innerHTML = '';
      loadedSession.messages.forEach(m => {
        const sender = m.role === 'user' ? 'user' : 'bot';
        this.addMessage(m.content, sender);
      });
    } else {
      // Default welcome message
      this.addWelcomeMessage();
    }
  }

  /**
   * Reset session and start fresh conversation
   */
  startNewChat() {
    this.sessionId = null;
    localStorage.removeItem('warrantyvault_rag_session_id');
    const list = document.getElementById('vibecode-chat-msg-list');
    if (list) {
      list.innerHTML = '';
      this.addWelcomeMessage();
    }
    this.loadDataSuggestions();
  }

  /**
   * Fetch real data-driven suggestions and render them as quick-action chips,
   * plus a personalized welcome summary from the user's vault.
   */
  async loadDataSuggestions() {
    if (!window.CopilotApi || !window.ApiService) return;
    try {
      const res = await window.CopilotApi.getSuggestions();
      if (!res || !res.success || !res.data) return;

      const suggestions = res.data.suggestions || [];
      const summary = res.data.summary || {};

      // 1. Personalized welcome summary
      const sym = window.getCurrencySymbol ? getCurrencySymbol() : '₹';
      const totalText = summary.totalSpend ? `${sym}${Number(summary.totalSpend).toLocaleString()}` : '$0';
      const welcomeParts = [
        `Hi! I've analyzed your vault: <strong>${summary.itemCount || 0} purchases</strong> (${totalText} total)`, //
        `⏳ ${summary.urgentReturns || 0} urgent return${summary.urgentReturns === 1 ? '' : 's'}`,
        `🛡️ ${summary.expiringWarranties || 0} ${summary.expiringWarranties === 1 ? 'warranty' : 'warranties'} expiring soon`
      ];
      if (summary.claimsOpen > 0) welcomeParts.push(`📄 ${summary.claimsOpen} claim${summary.claimsOpen === 1 ? '' : 's'} in progress`);
      const welcome = welcomeParts.join(' · ') + '.';

      const list = document.getElementById('vibecode-chat-msg-list');
      const firstMsg = list ? list.querySelector('.vibecode-chat-msg.bot') : null;
      if (firstMsg) {
        firstMsg.innerHTML = welcome;
      } else {
        this.addMessage(welcome, 'bot');
      }

      // 2. Replace static chips with data-driven ones (top 4, exclude DATA_GAP)
      const actionableChips = suggestions.filter(s => s.type !== 'DATA_GAP');
      this.renderSuggestionChips(actionableChips.slice(0, 4));
    } catch (e) {
      // Keep the static chips + default welcome when offline
    }
  }

  /**
   * Render suggestion chips from real data.
   */
  renderSuggestionChips(suggestions) {
    const container = document.getElementById('chatQuickActions');
    if (!container || !suggestions || suggestions.length === 0) return;

    const icons = {
      RETURN: '⏳',
      WARRANTY: '🛡️',
      CLAIM: '📄',
      DATA_GAP: '✏️',
      SPEND: '💰',
      HEALTHY: '✅'
    };

    container.innerHTML = suggestions.map(s => {
      const icon = icons[s.type] || '💡';
      const label = s.title.length > 34 ? s.title.slice(0, 32) + '…' : s.title;
      return `<button class="chat-chip" data-q="Give me a suggestion about: ${escapeHtmlForAttr(label)}">${icon} ${escapeHtml(label)}</button>`;
    }).join('') + `<button class="chat-chip" data-q="Give me suggestions">💡 All suggestions</button>`;

    // Re-bind chip clicks (existing form/chip bindings are gone after innerHTML swap)
    container.querySelectorAll('.chat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-q');
        this.addMessage(query, 'user');
        this.handleAiCopilotQuery(query, this);
      });
    });
  }

  injectStyles() {
    if (document.getElementById('chatbot-styles')) return;

    const style = document.createElement('style');
    style.id = 'chatbot-styles';
    style.textContent = `
      .vibecode-chat-widget {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9990;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      .vibecode-chat-toggle {
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2563EB 0%, #7C3AED 100%);
        color: #fff;
        border: none;
        cursor: pointer;
        box-shadow: 0 10px 25px rgba(37, 99, 235, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.4rem;
        transition: transform 0.25s ease, box-shadow 0.25s ease;
      }
      .vibecode-chat-toggle:hover {
        transform: scale(1.08);
        box-shadow: 0 14px 30px rgba(37, 99, 235, 0.55);
      }
      .vibecode-chat-box {
        position: absolute;
        bottom: 74px;
        right: 0;
        width: 380px;
        height: 520px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 120px);
        background: var(--glass-bg, #111827);
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
        border-radius: 22px;
        box-shadow: 0 24px 50px rgba(0, 0, 0, 0.55);
        display: none;
        flex-direction: column;
        overflow: hidden;
        backdrop-filter: blur(20px);
      }
      .vibecode-chat-box.open {
        display: flex;
        animation: chatBoxFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes chatBoxFadeIn {
        from { opacity: 0; transform: translateY(16px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .vibecode-chat-header {
        padding: 14px 18px;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .vibecode-chat-header-title {
        font-weight: 700;
        font-size: 0.95rem;
        color: var(--text-main, #fff);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vibecode-chat-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .vibecode-chat-header-btn {
        background: transparent;
        border: none;
        color: var(--text-muted, #a1a1aa);
        cursor: pointer;
        font-size: 0.85rem;
        padding: 5px 7px;
        border-radius: 6px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .vibecode-chat-header-btn:hover {
        color: #60a5fa;
        background: rgba(255, 255, 255, 0.08);
      }
      .vibecode-chat-close-btn {
        background: transparent;
        border: none;
        color: var(--text-muted, #a1a1aa);
        cursor: pointer;
        font-size: 1.3rem;
        padding: 0 4px;
        transition: color 0.2s ease;
      }
      .vibecode-chat-close-btn:hover {
        color: #ef4444;
      }
      .vibecode-chat-messages {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
      }
      .vibecode-chat-messages::-webkit-scrollbar {
        width: 5px;
      }
      .vibecode-chat-messages::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }
      .vibecode-chat-msg {
        max-width: 88%;
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 0.86rem;
        line-height: 1.55;
        word-break: break-word;
      }
      .vibecode-chat-msg.bot {
        align-self: flex-start;
        background: rgba(30, 41, 59, 0.85);
        color: #f1f5f9;
        border-bottom-left-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      }
      .vibecode-chat-msg.user {
        align-self: flex-end;
        background: linear-gradient(135deg, #2563EB 0%, #7C3AED 100%);
        color: #ffffff;
        border-bottom-right-radius: 4px;
        font-weight: 500;
        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
      }
      .chat-heading {
        font-weight: 700;
        font-size: 0.92rem;
        color: #60a5fa;
        margin: 4px 0 6px 0;
      }
      .chat-bullet-list {
        margin: 6px 0 8px 0;
        padding-left: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .chat-bullet-list li {
        position: relative;
        padding-left: 18px;
        line-height: 1.45;
        font-size: 0.84rem;
      }
      .chat-bullet-list li::before {
        content: '•';
        position: absolute;
        left: 4px;
        color: #38bdf8;
        font-weight: bold;
        font-size: 1.1rem;
        line-height: 1;
      }
      .chat-sources-tag {
        margin-top: 10px;
        padding: 8px 10px;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 10px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .chat-sources-label {
        font-size: 0.70rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #38bdf8;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .chat-sources-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .chat-source-pill {
        display: inline-flex;
        align-items: center;
        font-size: 0.72rem;
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #bae6fd;
        padding: 3px 8px;
        border-radius: 6px;
        white-space: nowrap;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .vibecode-chat-quick-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        padding: 0 16px 8px 16px;
      }
      .chat-chip {
        font-size: 0.72rem;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid var(--glass-border);
        color: var(--text-main);
        padding: 4px 10px;
        border-radius: 999px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .chat-chip:hover {
        background: #2563EB;
        color: #fff;
      }
      .vibecode-chat-input-area {
        padding: 12px;
        border-top: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
        display: flex;
        gap: 8px;
        background: rgba(0, 0, 0, 0.25);
      }
      .vibecode-chat-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        padding: 10px 14px;
        color: var(--text-main, #fff);
        font-size: 0.85rem;
        outline: none;
        font-family: inherit;
      }
      .vibecode-chat-send {
        background: #2563EB;
        color: #fff;
        border: none;
        border-radius: 12px;
        padding: 0 16px;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .vibecode-chat-send:hover {
        background: #1D4ED8;
      }
      .chat-sources-tag {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-top: 10px;
        padding: 8px 10px;
        background: rgba(99, 102, 241, 0.08);
        border: 1px solid rgba(99, 102, 241, 0.22);
        border-radius: 10px;
        font-size: 0.73rem;
      }
      .chat-sources-label {
        color: #818cf8;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .chat-sources-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .chat-source-pill {
        background: rgba(99, 102, 241, 0.16);
        color: #e0e7ff;
        border: 1px solid rgba(129, 140, 248, 0.35);
        padding: 2px 8px;
        border-radius: 6px;
        font-weight: 600;
        font-size: 0.72rem;
      }
      [data-theme="light"] .chat-sources-tag {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      [data-theme="light"] .chat-sources-label {
        color: #4f46e5;
      }
      [data-theme="light"] .chat-source-pill {
        background: #eef2ff;
        color: #3730a3;
        border-color: #c7d2fe;
      }
    `;
    document.head.appendChild(style);
  }

  render() {
    const widget = document.createElement('div');
    widget.id = this.containerId;
    widget.className = 'vibecode-chat-widget';

    widget.innerHTML = `
      <button class="vibecode-chat-toggle" id="vibecode-chat-toggle-btn" type="button" aria-label="Open Chat Assistant" title="AI Warranty & Spending Copilot">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
      </button>
      <div class="vibecode-chat-box" id="vibecode-chat-box">
        <div class="vibecode-chat-header">
          <span class="vibecode-chat-header-title"><i class="fa-solid fa-shield-halved" style="color: #60a5fa;"></i> ${this.title}</span>
          <div class="vibecode-chat-header-actions">
            <button class="vibecode-chat-header-btn" id="vibecode-chat-new-btn" type="button" title="Start New Chat / Reset"><i class="fa-solid fa-rotate"></i></button>
            <button class="vibecode-chat-close-btn" id="vibecode-chat-close-btn" type="button" title="Close">&times;</button>
          </div>
        </div>
        <div class="vibecode-chat-messages" id="vibecode-chat-msg-list"></div>
        <div class="vibecode-chat-quick-actions" id="chatQuickActions">
          <button class="chat-chip" data-q="What return deadlines are ending soon?">⏳ Urgent Returns</button>
          <button class="chat-chip" data-q="Which warranties expire in 30 days?">🛡️ Expiring Warranties</button>
          <button class="chat-chip" data-q="How much did I spend in total?">💰 Total Spend</button>
          <button class="chat-chip" data-q="What purchases do I have in my vault?">📦 My Purchases</button>
        </div>
        <form class="vibecode-chat-input-area" id="vibecode-chat-form">
          <input type="text" class="vibecode-chat-input" id="vibecode-chat-input" placeholder="Ask anything about your purchases..." required />
          <button type="submit" class="vibecode-chat-send"><i class="fa-solid fa-paper-plane"></i></button>
        </form>
      </div>
    `;

    document.body.appendChild(widget);

    const toggleBtn = widget.querySelector('#vibecode-chat-toggle-btn');
    const closeBtn = widget.querySelector('#vibecode-chat-close-btn');
    const newBtn = widget.querySelector('#vibecode-chat-new-btn');
    const chatBox = widget.querySelector('#vibecode-chat-box');
    const form = widget.querySelector('#vibecode-chat-form');

    toggleBtn.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      chatBox.classList.toggle('open', this.isOpen);
      if (this.isOpen) {
        const list = widget.querySelector('#vibecode-chat-msg-list');
        if (list) list.scrollTop = list.scrollHeight;
      }
    });

    closeBtn.addEventListener('click', () => {
      this.isOpen = false;
      chatBox.classList.remove('open');
    });

    if (newBtn) {
      newBtn.addEventListener('click', () => {
        this.startNewChat();
      });
    }

    // Quick Action Chips
    widget.querySelectorAll('.chat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-q');
        this.addMessage(query, 'user');
        this.handleAiCopilotQuery(query, this);
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = widget.querySelector('#vibecode-chat-input');
      const text = input.value.trim();
      if (!text) return;

      this.addMessage(text, 'user');
      input.value = '';
      this.handleAiCopilotQuery(text, this);
    });
  }

  addWelcomeMessage() {
    this.addMessage(this.welcomeMessage, 'bot');
  }

  addMessage(text, sender = 'bot', sources = null) {
    const list = document.getElementById('vibecode-chat-msg-list');
    if (!list) return;

    const msg = document.createElement('div');
    msg.className = `vibecode-chat-msg ${sender}`;

    let formattedText;
    if (sender === 'bot') {
      formattedText = this.formatBotMessage(text);
    } else {
      formattedText = escapeHtml(text).replace(/\n/g, '<br>');
    }

    // Add source tags if available
    let sourcesHtml = '';
    if (sources && Array.isArray(sources) && sources.length > 0) {
      const names = sources
        .map(s => s.productName || s.name)
        .filter(Boolean);
      const uniqueNames = [...new Set(names)];
      if (uniqueNames.length > 0) {
        const pills = uniqueNames.slice(0, 3).map(n => {
          let clean = String(n).trim();
          if (clean.length > 25) clean = clean.slice(0, 23).trim() + '…';
          return `<span class="chat-source-pill" title="${escapeHtmlForAttr(n)}">${escapeHtml(clean)}</span>`;
        }).join('');
        sourcesHtml = `
          <div class="chat-sources-tag">
            <span class="chat-sources-label"><i class="fa-solid fa-shield-halved"></i> Grounded Vault Sources:</span>
            <div class="chat-sources-pills">${pills}</div>
          </div>
        `;
      }
    }

    msg.innerHTML = formattedText + sourcesHtml;
    list.appendChild(msg);
    list.scrollTop = list.scrollHeight;
  }

  /**
   * Standardized Markdown Parser for Bot Responses
   */
  formatBotMessage(rawText) {
    if (!rawText) return '';
    let escaped = escapeHtml(rawText);

    // 1. Headers (### or ##)
    escaped = escaped.replace(/^###\s+(.+)$/gm, '<div class="chat-heading">$1</div>');
    escaped = escaped.replace(/^##\s+(.+)$/gm, '<div class="chat-heading">$1</div>');

    // 2. Bold & Italic
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 3. Bullet lists (lines starting with • or * or -)
    const lines = escaped.split('\n');
    let inList = false;
    const output = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      const isBullet = /^[•\-\*]\s+(.+)$/.test(line);

      if (isBullet) {
        const content = line.replace(/^[•\-\*]\s+/, '');
        if (!inList) {
          inList = true;
          output.push('<ul class="chat-bullet-list">');
        }
        output.push(`<li>${content}</li>`);
      } else {
        if (inList) {
          output.push('</ul>');
          inList = false;
        }
        if (line) {
          output.push(`<div>${line}</div>`);
        } else {
          output.push('<div style="height:6px"></div>');
        }
      }
    }

    if (inList) {
      output.push('</ul>');
    }

    return output.join('');
  }

  async handleAiCopilotQuery(query, instance) {
    // Show typing indicator
    const typingId = `typing_${Date.now()}`;
    const list = document.getElementById('vibecode-chat-msg-list');
    const typingEl = document.createElement('div');
    typingEl.id = typingId;
    typingEl.className = 'vibecode-chat-msg bot';
    typingEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI retrieving grounded context from your vault...';
    list.appendChild(typingEl);
    list.scrollTop = list.scrollHeight;

    try {
      // 1. Primary RAG pipeline: POST /api/chat (Hybrid RAG + grounded Gemini)
      let res;
      if (window.ChatApi) {
        res = await window.ChatApi.chat(query, this.sessionId || null);
      } else if (window.ApiService) {
        res = await window.ApiService.post('/chat', { message: query, sessionId: this.sessionId || null });
      }

      typingEl.remove();

      if (res && res.success && res.answer) {
        if (res.sessionId) {
          this.sessionId = res.sessionId;
          localStorage.setItem('warrantyvault_rag_session_id', this.sessionId);
        }
        instance.addMessage(res.answer, 'bot', res.sources);
        return;
      }

      // 2. Fallback to CopilotApi if ChatApi failed
      if (window.CopilotApi) {
        const copilotRes = await window.CopilotApi.chat(query, this.sessionId || null);
        if (copilotRes && copilotRes.success && copilotRes.data && copilotRes.data.answer) {
          if (copilotRes.data.sessionId) {
            this.sessionId = copilotRes.data.sessionId;
            localStorage.setItem('warrantyvault_rag_session_id', this.sessionId);
          }
          instance.addMessage(copilotRes.data.answer, 'bot');
          return;
        }
      }

      throw new Error((res && res.message) || 'RAG service unavailable.');
    } catch (err) {
      typingEl.remove();
      instance.addMessage("I couldn't retrieve that information right now. Please make sure you are logged in and have purchases in your vault.", 'bot');
    }
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

function escapeHtmlForAttr(str) {
  return escapeHtml(str).replace(/&quot;/g, '&quot;');
}

window.ChatbotComponent = ChatbotComponent;
