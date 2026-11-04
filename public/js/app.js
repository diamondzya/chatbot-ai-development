/* ==========================================================================
   STI Assist AI — browser client
   Conversations live in memory only. Uploaded images are held by the server
   for a short time and are never saved to disk by this app.
   ========================================================================== */

(() => {
  'use strict';

  const FALLBACK_SUGGESTIONS = [
    {
      label: 'Forgot my ID',
      question: 'What should I do if I forget my school ID?',
      icon: 'badge',
    },
    {
      label: 'Tardiness',
      question: 'What are the rules about being late to class?',
      icon: 'clock',
    },
    {
      label: 'Phone use',
      question: 'Can I use my phone during class?',
      icon: 'phone',
    },
    {
      label: 'Uniform rules',
      question: 'What are the uniform requirements?',
      icon: 'shirt',
    },
    {
      label: 'Lost item',
      question: 'What should I do if I lose something at school?',
      icon: 'search',
    },
    {
      label: 'Discipline',
      question: 'Where can I find the school’s disciplinary policies?',
      icon: 'shield',
    },
    {
      label: 'Taglish',
      question: 'Nakalimutan ko ID ko, makakapasok pa ba ako?',
      icon: 'chat',
    },
    {
      label: 'Bullying',
      question: 'What does the handbook say about bullying and harassment?',
      icon: 'shield',
    },
  ];

  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);
  const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
  const KNOWN_ICONS = new Set([
    'menu',
    'plus',
    'send',
    'paperclip',
    'x',
    'copy',
    'refresh',
    'trash',
    'shield',
    'book',
    'sparkles',
    'badge',
    'clock',
    'phone',
    'shirt',
    'search',
    'chat',
    'info',
    'alert',
    'image',
    'check',
    'lock',
    'cap',
    'chevron',
    'arrow',
    'file',
    'globe',
    'sun',
    'moon',
    'monitor',
    'mic',
    'thumb-up',
    'thumb-down',
    'list',
  ]);
  const TYPING_PHRASES = [
    'Searching the handbook…',
    'Checking the relevant sections…',
    'Preparing a grounded answer…',
  ];
  const DEFAULT_IMAGE_QUESTION = 'Please read this image and tell me what it says.';

  const state = {
    clientId: '',
    meta: null,
    demoMode: null,
    aiVerified: false,
    serverOffline: false,
    // The terms gate stays closed until storage (or an explicit accept) says
    // otherwise; see readTermsAcceptance() and init().
    termsAccepted: false,
    messages: [],
    attachment: null,
    uploadSeq: 0,
    busy: false,
    maxChars: 2000,
    preferExcerpts: false,
    // The Cloudflare Workers deployment disables image uploads (see README);
    // /api/meta reports the real capability on every load.
    imageUploadsEnabled: true,
    animatedIds: new Set(),
  };

  let typingTimer = null;
  let typingIndex = 0;
  let lastFocused = null;
  // A locked modal (the first-visit terms gate) ignores Escape, backdrop
  // clicks, and the close button; only its own actions can close it.
  let modalLocked = false;

  const $ = (id) => document.getElementById(id);

  const els = {
    sidebar: $('sidebar'),
    sidebarOverlay: $('sidebarOverlay'),
    sidebarClose: $('sidebarClose'),
    sidebarSuggestions: $('sidebarSuggestions'),
    sidebarConnection: $('sidebarConnection'),
    sidebarDot: $('sidebarDot'),
    sidebarMode: $('sidebarMode'),
    menuBtn: $('menuBtn'),
    brandBtn: $('brandBtn'),
    newChatBtn: $('newChatBtn'),
    aboutBtn: $('aboutBtn'),
    clearBtn: $('clearBtn'),
    headerMode: $('headerMode'),
    headerModeText: $('headerModeText'),
    topbarSub: $('topbarSub'),
    demoBanner: $('demoBanner'),
    handbookTitle: $('handbookTitle'),
    handbookMeta: $('handbookMeta'),
    handbookPages: $('handbookPages'),
    handbookOpen: $('handbookOpen'),
    welcome: $('welcome'),
    startCards: $('startCards'),
    messageList: $('messageList'),
    typingRow: $('typingRow'),
    typingText: $('typingText'),
    chatScroll: $('main'),
    composer: $('composer'),
    attachmentPreview: $('attachmentPreview'),
    attachmentThumb: $('attachmentThumb'),
    attachmentName: $('attachmentName'),
    attachmentStatus: $('attachmentStatus'),
    uploadProgress: $('uploadProgress'),
    uploadProgressBar: $('uploadProgressBar'),
    removeAttachment: $('removeAttachment'),
    attachBtn: $('attachBtn'),
    fileInput: $('fileInput'),
    messageInput: $('messageInput'),
    sendBtn: $('sendBtn'),
    composerHint: $('composerHint'),
    charCount: $('charCount'),
    jumpLatest: $('jumpLatest'),
    themeBtn: $('themeBtn'),
    themeIcon: $('themeIcon'),
    themeMenu: $('themeMenu'),
    paletteBtn: $('paletteBtn'),
    paletteBackdrop: $('paletteBackdrop'),
    paletteInput: $('paletteInput'),
    paletteList: $('paletteList'),
    excerptsToggle: $('excerptsToggle'),
    micBtn: $('micBtn'),
    sourceSkeleton: $('sourceSkeleton'),
    indexNotice: $('indexNotice'),
    tocBlock: $('tocBlock'),
    tocList: $('tocList'),
    ttlNote: $('ttlNote'),
    aboutLink: $('aboutLink'),
    termsLink: $('termsLink'),
    termsBtn: $('termsBtn'),
    modalBackdrop: $('modalBackdrop'),
    modal: $('modal'),
    modalTitle: $('modalTitle'),
    modalBody: $('modalBody'),
    modalClose: $('modalClose'),
    modalFoot: document.querySelector('.modal-foot'),
    toastRegion: $('toastRegion'),
  };

  // ------------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------------

  function makeId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }

  function getClientId() {
    const valid = /^[A-Za-z0-9-]{8,64}$/;
    try {
      const stored = window.localStorage.getItem('sti-assist-client-id');
      if (stored && valid.test(stored)) return stored;
      const created = makeId();
      window.localStorage.setItem('sti-assist-client-id', created);
      return created;
    } catch {
      return makeId();
    }
  }

  // ------------------------------------------------------------------------
  // Theme
  // ------------------------------------------------------------------------

  const THEME_KEY = 'sti-theme';
  const THEME_CHOICES = ['system', 'light', 'dark'];

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function systemPrefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function readThemeChoice() {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (THEME_CHOICES.includes(saved)) return saved;
    } catch {
      /* Ignore blocked storage. */
    }
    return 'system';
  }

  function applyTheme(theme) {
    const dark = theme === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a1120' : '#0b1c3d');
  }

  function applyThemeChoice(choice, { persist = true } = {}) {
    const safe = THEME_CHOICES.includes(choice) ? choice : 'system';
    if (persist) {
      try {
        window.localStorage.setItem(THEME_KEY, safe);
      } catch {
        /* Storage can be blocked; the theme still applies for this page. */
      }
    }
    applyTheme(safe === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : safe);

    els.themeMenu?.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.themeChoice === safe));
    });
    if (els.themeIcon) {
      // The trigger shows the active choice: a monitor for "follow system".
      els.themeIcon.setAttribute(
        'href',
        safe === 'system' ? '#i-monitor' : safe === 'dark' ? '#i-moon' : '#i-sun'
      );
    }
    if (els.themeBtn) {
      const label = `Theme: ${safe}`;
      els.themeBtn.title = label;
      els.themeBtn.setAttribute('aria-label', `${label}. Change theme`);
    }
  }

  function setThemeMenuOpen(open) {
    if (!els.themeMenu) return;
    els.themeMenu.hidden = !open;
    els.themeBtn.setAttribute('aria-expanded', String(open));
  }

  function initTheme() {
    // theme.js already painted the saved theme; this also covers the case
    // where that bootstrap did not run (for example, a cached page).
    applyThemeChoice(readThemeChoice(), { persist: false });
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readThemeChoice() === 'system') applyThemeChoice('system', { persist: false });
    };
    if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
    else if (typeof query.addListener === 'function') query.addListener(onChange);
  }

  function iconEl(name, className = 'icon') {
    const safe = KNOWN_ICONS.has(name) ? name : 'info';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${safe}`);
    svg.appendChild(use);
    return svg;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
  }

  function formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatPage(source) {
    const start = Number(source && source.page);
    const end = Number(source && source.pageEnd);
    if (!Number.isFinite(start)) return 'Page unavailable';
    if (!Number.isFinite(end) || end === start) return `p. ${start}`;
    return `pp. ${start}–${end}`;
  }

  function isNearBottom() {
    const el = els.chatScroll;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  function scrollToBottom({ smooth = true, force = false } = {}) {
    const el = els.chatScroll;
    if (!el) return;
    if (!force && !isNearBottom()) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function updateJumpLatest() {
    const el = els.chatScroll;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    els.jumpLatest.hidden = state.messages.length === 0 || distance < 320;
  }

  class ApiError extends Error {
    constructor(message, { status = 0, code = 'request_failed' } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  async function apiFetch(path, { method = 'GET', body, timeout = 30000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = {
      Accept: 'application/json',
      'X-Client-Id': state.clientId,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      const response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : body,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        const message =
          (data && data.error && data.error.message) ||
          `The server returned an error (HTTP ${response.status}). Please try again.`;
        throw new ApiError(message, {
          status: response.status,
          code: (data && data.error && data.error.code) || 'request_failed',
        });
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && error.name === 'AbortError') {
        throw new ApiError('The request took too long to finish. Please try again.', {
          code: 'timeout',
        });
      }
      throw new ApiError(
        'I couldn’t reach the server. Make sure it is running, then try again.',
        { code: 'network_error' }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function parseSseBlock(block) {
    let event = 'message';
    const dataLines = [];
    for (const line of String(block || '').split(/\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0) return null;
    let data = null;
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      data = null;
    }
    return { event, data };
  }

  // Older servers and some proxies do not expose the streaming route. Remember
  // that so the rest of the session goes straight to the non-streaming endpoint.
  let streamEndpointUnavailable = false;

  async function streamChat(payload, { onSources, onDelta } = {}) {
    if (streamEndpointUnavailable) {
      return apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeout: 150000,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150000);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'X-Client-Id': state.clientId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 404 || response.status === 405) {
        // The server predates /api/chat/stream (or a proxy blocks it). Use the
        // non-streaming endpoint, which returns the same final response shape.
        streamEndpointUnavailable = true;
        try {
          await response.text();
        } catch {
          // The 404 body is irrelevant.
        }
        return apiFetch('/api/chat', {
          method: 'POST',
          body: JSON.stringify(payload),
          timeout: 150000,
        });
      }

      if (!response.ok) {
        const text = await response.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
        }
        throw new ApiError(
          (data && data.error && data.error.message) ||
            `The server returned an error (HTTP ${response.status}). Please try again.`,
          {
            status: response.status,
            code: (data && data.error && data.error.code) || 'request_failed',
          }
        );
      }

      const contentType = String(response.headers.get('content-type') || '');
      if (!contentType.includes('text/event-stream')) {
        // A proxy or an older server may not stream. Its JSON body has the same
        // shape as the final `done` event.
        try {
          return await response.json();
        } catch {
          throw new ApiError(
            'The server returned a response that could not be read. Please try again.',
            { code: 'bad_response' }
          );
        }
      }
      if (!response.body) {
        throw new ApiError('The server response could not be read. Please try again.', {
          code: 'stream_unavailable',
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;
      let failure = null;

      const consume = (block) => {
        const parsed = parseSseBlock(block);
        if (!parsed) return;
        if (parsed.event === 'sources') {
          onSources?.(parsed.data || {});
        } else if (parsed.event === 'delta') {
          onDelta?.(String(parsed.data?.text || ''));
        } else if (parsed.event === 'done') {
          result = parsed.data;
        } else if (parsed.event === 'error') {
          failure = parsed.data?.error || {
            code: 'stream_error',
            message: 'The answer could not be completed. Please try again.',
          };
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
        }
      }
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.trim()) consume(buffer);

      if (failure) {
        throw new ApiError(failure.message, {
          code: failure.code || 'stream_error',
          status: Number(failure.status) || 0,
        });
      }
      if (!result) {
        throw new ApiError(
          'The server closed the connection before the answer was complete. Please try again.',
          { code: 'stream_incomplete' }
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && error.name === 'AbortError') {
        throw new ApiError('The request took too long to finish. Please try again.', {
          code: 'timeout',
        });
      }
      throw new ApiError(
        'I couldn’t reach the server. Make sure it is running, then try again.',
        { code: 'network_error' }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------------
  // Toasts and modal
  // ------------------------------------------------------------------------

  function showToast(message, tone = 'info', duration = 4200) {
    const toast = document.createElement('div');
    toast.className = `toast is-${tone}`;
    toast.appendChild(iconEl(tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'));
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    toast.addEventListener('click', () => toast.remove());
    els.toastRegion.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function openModal({ title, body, actions, locked = false, initialFocus = null }) {
    lastFocused = document.activeElement;
    modalLocked = locked;
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = body;
    els.modalFoot.replaceChildren();
    // A locked modal has no close button: the user must choose an action.
    els.modalClose.hidden = locked;

    const list = Array.isArray(actions) && actions.length
      ? actions
      : [{ label: 'Got it', variant: 'primary', onClick: () => {} }];

    let firstAction = null;
    for (const action of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        action.variant === 'secondary'
          ? 'secondary-btn'
          : action.variant === 'danger'
            ? 'primary-btn danger-btn'
            : 'primary-btn';
      button.textContent = action.label;
      if (action.id) button.id = action.id;
      if (action.disabled) button.disabled = true;
      button.addEventListener('click', () => {
        const result = action.onClick ? action.onClick() : undefined;
        if (result !== false) closeModal();
      });
      els.modalFoot.appendChild(button);
      if (!firstAction) firstAction = button;
    }

    els.modalBackdrop.hidden = false;
    document.body.classList.add('modal-open');
    // Focus the requested control, otherwise the first action for a locked
    // gate, otherwise the close button.
    requestAnimationFrame(() => {
      const preferred = initialFocus ? els.modalBody.querySelector(initialFocus) : null;
      if (preferred) preferred.focus();
      else if (locked && firstAction) firstAction.focus();
      else els.modalClose.focus();
    });
    return els.modalFoot;
  }

  function closeModal() {
    if (els.modalBackdrop.hidden) return;
    // A locked modal (the terms gate) can only be closed by accepting it.
    if (modalLocked) return;
    els.modalBackdrop.hidden = true;
    document.body.classList.remove('modal-open');
    els.modalBody.replaceChildren();
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function forceCloseModal() {
    modalLocked = false;
    closeModal();
  }

  function trapModalFocus(event) {
    if (els.modalBackdrop.hidden || event.key !== 'Tab') return;
    const focusable = Array.from(
      els.modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ------------------------------------------------------------------------
  // Sidebar
  // ------------------------------------------------------------------------

  function openSidebar() {
    if (window.innerWidth > 960) return;
    els.sidebar.classList.add('is-open');
    els.sidebarOverlay.hidden = false;
    els.menuBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sidebar-open');
    els.sidebarClose.focus();
  }

  function closeSidebar({ restoreFocus = false } = {}) {
    const wasOpen = els.sidebar.classList.contains('is-open');
    els.sidebar.classList.remove('is-open');
    els.sidebarOverlay.hidden = true;
    els.menuBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-open');
    if (wasOpen && restoreFocus) els.menuBtn.focus();
  }

  // ------------------------------------------------------------------------
  // Metadata and status
  // ------------------------------------------------------------------------

  function applyModeState() {
    els.headerMode.classList.remove('is-loading', 'is-demo', 'is-ai', 'is-offline');
    els.sidebarDot.className = 'status-dot';

    if (state.serverOffline) {
      els.headerMode.classList.add('is-offline');
      els.sidebarDot.classList.add('is-offline');
      els.headerModeText.textContent = 'Server offline';
      els.headerMode.dataset.short = 'Offline';
      els.sidebarMode.textContent = 'Server offline';
      els.headerMode.title = 'The local server cannot be reached.';
      els.headerMode.setAttribute('aria-label', 'Server offline');
      return;
    }

    if (state.demoMode === null) {
      els.headerMode.classList.add('is-loading');
      els.headerModeText.textContent = 'Connecting';
      els.headerMode.dataset.short = '…';
      els.sidebarMode.textContent = 'Connecting…';
      els.headerMode.setAttribute('aria-label', 'Connecting to the local server');
      return;
    }

    if (state.demoMode) {
      els.headerMode.classList.add('is-demo');
      els.sidebarDot.classList.add('is-demo');
      els.headerModeText.textContent = 'Demo · not AI';
      els.headerMode.dataset.short = 'Demo';
      els.sidebarMode.textContent = 'Local demo · not AI';
      els.headerMode.title =
        'No AI provider is configured. Answers are direct handbook excerpts, not AI-generated.';
      els.headerMode.setAttribute('aria-label', 'Demo mode, not AI');
      return;
    }

    els.headerMode.classList.add('is-ai');
    els.sidebarDot.classList.add('is-ai');
    if (state.aiVerified) {
      els.headerModeText.textContent = 'AI verified';
      els.headerMode.dataset.short = 'Verified';
      els.sidebarMode.textContent = 'AI verified this session';
      els.headerMode.title = 'An AI response was generated successfully in this browser session.';
      els.headerMode.setAttribute('aria-label', 'AI verified this session');
    } else {
      els.headerModeText.textContent = 'AI configured';
      els.headerMode.dataset.short = 'AI';
      els.sidebarMode.textContent = 'AI configured · not verified';
      els.headerMode.title =
        'An AI provider is configured, but no AI response has succeeded in this browser session yet.';
      els.headerMode.setAttribute('aria-label', 'AI configured, not verified');
    }
  }

  function normaliseSuggestions(items) {
    if (!Array.isArray(items)) return FALLBACK_SUGGESTIONS;
    const cleaned = items
      .filter((item) => item && typeof item.question === 'string' && item.question.trim())
      .map((item) => ({
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.question,
        question: item.question.trim(),
        icon: typeof item.icon === 'string' ? item.icon : 'chat',
      }));
    return cleaned.length ? cleaned : FALLBACK_SUGGESTIONS;
  }

  function renderSuggestions(items) {
    const suggestions = normaliseSuggestions(items);
    els.sidebarSuggestions.replaceChildren();
    els.startCards.replaceChildren();

    suggestions.forEach((item) => {
      const side = document.createElement('button');
      side.type = 'button';
      side.className = 'suggestion-item';
      side.dataset.question = item.question;
      side.appendChild(iconEl(item.icon));
      const label = document.createElement('span');
      label.textContent = item.label;
      side.appendChild(label);
      els.sidebarSuggestions.appendChild(side);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'start-card';
      card.dataset.question = item.question;
      card.title = item.question;
      const iconWrap = document.createElement('span');
      iconWrap.className = 'start-icon';
      iconWrap.appendChild(iconEl(item.icon));
      const copy = document.createElement('span');
      copy.className = 'start-copy';
      const cardLabel = document.createElement('span');
      cardLabel.className = 'start-label';
      cardLabel.textContent = item.label;
      const question = document.createElement('span');
      question.className = 'start-question';
      question.textContent = item.question;
      copy.append(cardLabel, question);
      const arrow = iconEl('arrow', 'icon start-arrow');
      card.append(iconWrap, copy, arrow);
      els.startCards.appendChild(card);
    });
  }

  function applyMeta(meta) {
    state.meta = meta;
    state.serverOffline = false;
    state.demoMode = Boolean(meta && meta.mode && meta.mode.demo);
    state.maxChars = Number(meta?.limits?.maxMessageChars) || 2000;
    els.messageInput.maxLength = state.maxChars;
    state.imageUploadsEnabled = !(meta?.capabilities && meta.capabilities.imageUploads === false);
    if (!state.imageUploadsEnabled) {
      els.attachBtn.title = 'Image uploads are not available on this deployment';
    }

    renderSuggestions(meta?.suggestedQuestions);

    const handbook = meta?.handbook;
    if (handbook) {
      els.handbookTitle.textContent = handbook.title || 'STI High School Student Handbook';
      els.handbookMeta.textContent = handbook.published
        ? `Published ${handbook.published}${handbook.edition ? ` · ${handbook.edition}` : ''}`
        : 'STI High School Student Handbook';
      if (handbook.pagesIndexed) {
        els.handbookPages.textContent = `Indexed pp. ${handbook.pagesIndexed.from}–${handbook.pagesIndexed.to}`;
      }
      if (handbook.openUrl) {
        els.handbookOpen.href = handbook.openUrl;
        els.handbookOpen.hidden = false;
      } else {
        els.handbookOpen.hidden = true;
      }
      const parts = [];
      if (handbook.title) parts.push(handbook.title.replace(' Student Handbook', ''));
      if (handbook.published) parts.push(handbook.published);
      if (handbook.pagesIndexed) {
        parts.push(`pp. ${handbook.pagesIndexed.from}–${handbook.pagesIndexed.to}`);
      }
      els.topbarSub.textContent = parts.join(' · ') || 'Student handbook assistant';
    }

    const ttl = meta?.limits?.attachmentTtlMinutes;
    if (Number.isFinite(Number(ttl)) && Number(ttl) > 0) {
      els.ttlNote.textContent = String(ttl);
    }

    els.demoBanner.hidden = !state.demoMode;
    els.indexNotice.hidden = !(handbook && handbook.stale === true);
    updateExcerptsToggle();
    applyModeState();
    updateComposer();
  }

  function applyOfflineState() {
    state.serverOffline = true;
    state.demoMode = null;
    state.meta = null;
    applyModeState();
    els.demoBanner.hidden = true;
    els.indexNotice.hidden = true;
    renderSuggestions(FALLBACK_SUGGESTIONS);
    showToast(
      'The server is not responding. Start it with “npm start”, then reload this page.',
      'error',
      6500
    );
  }

  async function loadMeta() {
    try {
      const meta = await apiFetch('/api/meta', { timeout: 15000 });
      applyMeta(meta);
    } catch {
      applyOfflineState();
    }
  }

  // ------------------------------------------------------------------------
  // Markdown (small, safe renderer)
  // ------------------------------------------------------------------------

  function inlineMarkdown(escaped) {
    const tokens = [];
    let text = escaped.replace(/`([^`\n]+)`/g, (_match, code) => {
      tokens.push(`<code>${code}</code>`);
      return `\uE000${tokens.length - 1}\uE001`;
    });

    text = text.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi,
      (_match, label, url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    text = text.replace(/\uE000(\d+)\uE001/g, (_match, index) => tokens[Number(index)] || '');
    return text;
  }

  function renderParagraphs(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${inlineMarkdown(escapeHtml(paragraph))}</p>`)
      .join('');
  }

  function isBlockStart(line) {
    return (
      /^```/.test(line) ||
      /^(#{1,4})\s+/.test(line) ||
      /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
      /^\s*>\s?/.test(line) ||
      /^\s*([-*•]|\d+[.)])\s+/.test(line)
    );
  }

  function renderMarkdown(raw) {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i += 1;
        continue;
      }

      if (/^```/.test(line.trim())) {
        i += 1;
        const code = [];
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const tag = heading[1].length <= 2 ? 'h3' : 'h4';
        html += `<${tag}>${inlineMarkdown(escapeHtml(heading[2].trim()))}</${tag}>`;
        i += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += '<hr>';
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoted = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoted.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        html += `<blockquote>${renderParagraphs(quoted.join('\n'))}</blockquote>`;
        continue;
      }

      const listItem = line.match(/^\s*([-*•]|\d+[.)])\s+(.+)$/);
      if (listItem) {
        const ordered = /\d/.test(listItem[1]);
        const items = [];
        while (i < lines.length) {
          const match = lines[i].match(/^\s*([-*•]|\d+[.)])\s+(.+)$/);
          if (!match) break;
          items.push(match[2].trim());
          i += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        html += `<${tag}>${items
          .map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`)
          .join('')}</${tag}>`;
        continue;
      }

      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
        paragraph.push(lines[i].trim());
        i += 1;
      }
      if (paragraph.length === 0) {
        i += 1;
        continue;
      }
      html += `<p>${inlineMarkdown(escapeHtml(paragraph.join(' ')))}</p>`;
    }

    return html;
  }

  // ------------------------------------------------------------------------
  // Message rendering
  // ------------------------------------------------------------------------

  function buildTag(className, iconName, label) {
    const tag = document.createElement('span');
    tag.className = `meta-tag ${className}`;
    tag.appendChild(iconEl(iconName));
    tag.appendChild(document.createTextNode(label));
    return tag;
  }

  function cleanExcerpt(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function buildSources(sources, question = '') {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    const terms = questionTerms(question);
    const block = document.createElement('div');
    block.className = 'sources-block';

    const title = document.createElement('p');
    title.className = 'sources-title';
    title.appendChild(iconEl('book'));
    title.appendChild(document.createTextNode(`Handbook sources · ${sources.length}`));
    block.appendChild(title);

    const list = document.createElement('div');
    list.className = 'source-list';

    sources.forEach((source, index) => {
      const details = document.createElement('details');
      details.className = 'source-card';
      if (Number.isFinite(Number(source.page))) details.dataset.page = String(Number(source.page));

      const summary = document.createElement('summary');
      const number = document.createElement('span');
      number.className = 'source-index';
      number.textContent = String(index + 1);

      const main = document.createElement('span');
      main.className = 'source-main';
      const name = document.createElement('span');
      name.className = 'source-name';
      name.textContent = source.section || 'Handbook section';
      const chapter = document.createElement('span');
      chapter.className = 'source-chapter';
      chapter.textContent = source.chapter || 'STI High School Student Handbook';
      main.append(name, chapter);

      const page = document.createElement('span');
      page.className = 'source-page';
      page.textContent = formatPage(source);

      const chevron = iconEl('chevron', 'icon source-chevron');
      summary.append(number, main, page, chevron);

      const excerpt = document.createElement('div');
      excerpt.className = 'source-excerpt';
      const excerptText = document.createElement('div');
      excerptText.className = 'source-excerpt-text';
      excerptText.appendChild(
        highlightExcerpt(cleanExcerpt(source.excerpt) || 'No excerpt available.', terms)
      );
      excerpt.appendChild(excerptText);

      const openUrl = state.meta?.handbook?.openUrl;
      const offset = Number(state.meta?.handbook?.pdfPageOffset);
      const pdfPage = Number.isFinite(Number(source.pdfPage))
        ? Number(source.pdfPage)
        : Number(source.page) + (Number.isFinite(offset) ? offset : 1);
      if (openUrl && Number.isFinite(pdfPage) && pdfPage > 0) {
        const foot = document.createElement('div');
        foot.className = 'source-foot';

        const note = document.createElement('span');
        note.className = 'source-foot-note';
        note.textContent = 'Verify this citation';

        const link = document.createElement('a');
        link.className = 'source-link';
        link.href = `${openUrl}#page=${pdfPage}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = `Open PDF page ${pdfPage} (printed page ${source.page})`;
        link.appendChild(iconEl('file'));
        link.appendChild(document.createTextNode(`Open PDF · p. ${pdfPage}`));

        foot.append(note, link);
        details.append(summary, excerpt, foot);
      } else {
        details.append(summary, excerpt);
      }
      list.appendChild(details);
    });

    block.appendChild(list);
    return block;
  }

  function buildWarning(warning) {
    const box = document.createElement('div');
    box.className = 'warning-box';
    box.appendChild(iconEl('alert'));
    const text = document.createElement('span');
    text.textContent = warning;
    box.appendChild(text);
    return box;
  }

  function buildImageNote(image) {
    if (!image) return null;
    const card = document.createElement('div');
    card.className = 'image-card';
    card.appendChild(iconEl('image'));
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = image.analyzed ? 'Image analyzed. ' : 'Image not analyzed. ';
    text.appendChild(strong);
    const details = [];
    if (image.name) details.push(image.name);
    if (image.width && image.height) details.push(`${image.width}×${image.height}`);
    if (image.warning) details.push(image.warning);
    text.appendChild(document.createTextNode(details.join(' · ')));
    card.appendChild(text);
    return card;
  }

  function buildMessageElement(message, index) {
    const row = document.createElement('article');
    row.className = `message ${message.role}`;
    row.dataset.id = message.id;
    if (state.animatedIds.has(message.id)) row.classList.add('no-anim');
    else state.animatedIds.add(message.id);

    const avatar = document.createElement('div');
    avatar.className = `avatar ${message.role === 'user' ? 'user-avatar' : 'assistant-avatar'}`;
    avatar.setAttribute('aria-hidden', 'true');
    if (message.role === 'user') {
      avatar.textContent = 'You';
    } else {
      avatar.appendChild(iconEl('cap'));
    }

    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (message.streaming) {
      bubble.classList.add('is-streaming');
      bubble.setAttribute('aria-busy', 'true');
    }
    if (message.error) bubble.classList.add('is-error');
    if (message.safety && message.safety.level === 'emergency') bubble.classList.add('is-safety');

    if (message.role === 'user' && message.attachmentName) {
      const chip = document.createElement('div');
      chip.className = 'user-attachment';
      chip.appendChild(iconEl('image'));
      const chipText = document.createElement('span');
      chipText.textContent = message.attachmentName;
      chip.appendChild(chipText);
      bubble.appendChild(chip);
    }

    if (message.error) {
      const paragraph = document.createElement('p');
      paragraph.textContent = message.content;
      bubble.appendChild(paragraph);
    } else {
      bubble.innerHTML = renderMarkdown(message.content);
      if (message.role === 'assistant') {
        enhanceCitations(bubble, message.sources, message.id);
      }
    }
    wrap.appendChild(bubble);

    const sources = buildSources(message.sources, message.question);
    if (sources) wrap.appendChild(sources);

    if (Array.isArray(message.followUps) && message.followUps.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'follow-ups';
      chips.setAttribute('aria-label', 'Suggested follow-up questions');
      message.followUps.forEach((item) => {
        if (!item || typeof item.question !== 'string' || !item.question.trim()) return;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'follow-up';
        chip.dataset.question = item.question;
        chip.appendChild(iconEl('sparkles'));
        chip.appendChild(document.createTextNode(item.label || item.question));
        chip.title = item.question;
        chips.appendChild(chip);
      });
      if (chips.childElementCount > 0) wrap.appendChild(chips);
    }

    if (Array.isArray(message.warnings)) {
      message.warnings.slice(0, 3).forEach((warning) => {
        if (warning) wrap.appendChild(buildWarning(warning));
      });
    }

    const imageNote = buildImageNote(message.image);
    if (imageNote) wrap.appendChild(imageNote);

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    if (message.role === 'assistant') {
      if (message.error) {
        const failTag = buildTag('guide', 'alert', 'Request failed');
        meta.appendChild(failTag);
      } else if (message.interrupted) {
        meta.appendChild(buildTag('guide', 'alert', 'Incomplete'));
      } else if (message.safety && message.safety.level !== 'none') {
        meta.appendChild(buildTag('safety', 'shield', 'Safety guidance'));
      } else if (message.mode === 'ai' && message.aiGenerated) {
        meta.appendChild(buildTag('ai', 'sparkles', 'AI-generated'));
      } else if (message.mode === 'demo') {
        meta.appendChild(buildTag('demo', 'info', 'Local demo · not AI'));
      } else if (message.mode === 'excerpts') {
        meta.appendChild(buildTag('demo', 'info', 'Handbook excerpts · not AI'));
      } else if (message.mode === 'guide') {
        meta.appendChild(buildTag('guide', 'book', 'Rule-based'));
      }

      const time = document.createElement('span');
      time.textContent = formatTime(message.createdAt);
      meta.appendChild(time);

      const actions = document.createElement('span');
      actions.className = 'meta-actions';

      if (!message.error && message.content) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'meta-btn';
        copy.dataset.action = 'copy';
        copy.dataset.id = message.id;
        copy.title = 'Copy the answer and its sources';
        copy.appendChild(iconEl('copy'));
        copy.appendChild(document.createTextNode('Copy'));
        actions.appendChild(copy);
      }

      if (!message.error && !message.streaming && message.content) {
        const vote = document.createElement('button');
        vote.type = 'button';
        vote.className = `meta-btn${message.feedback === 'helpful' ? ' is-voted' : ''}`;
        vote.dataset.action = 'vote-up';
        vote.dataset.id = message.id;
        vote.title = 'This answer was helpful';
        vote.setAttribute('aria-pressed', String(message.feedback === 'helpful'));
        vote.appendChild(iconEl('thumb-up'));
        vote.appendChild(document.createTextNode('Helpful'));
        actions.appendChild(vote);

        const down = document.createElement('button');
        down.type = 'button';
        down.className = `meta-btn${message.feedback === 'not_helpful' ? ' is-voted' : ''}`;
        down.dataset.action = 'vote-down';
        down.dataset.id = message.id;
        down.title = 'This answer needs work';
        down.setAttribute('aria-pressed', String(message.feedback === 'not_helpful'));
        down.appendChild(iconEl('thumb-down'));
        down.appendChild(document.createTextNode('Needs work'));
        actions.appendChild(down);
      }

      const isLast = index === state.messages.length - 1;
      const canRetry =
        isLast &&
        !state.busy &&
        (message.error || message.mode === 'ai' || message.mode === 'demo') &&
        !(message.image && !message.error);
      if (canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'meta-btn';
        retry.dataset.action = 'retry';
        retry.dataset.id = message.id;
        retry.appendChild(iconEl('refresh'));
        retry.appendChild(document.createTextNode('Retry'));
        actions.appendChild(retry);
      }

      if (actions.childElementCount) meta.appendChild(actions);
    } else {
      const time = document.createElement('span');
      time.textContent = formatTime(message.createdAt);
      meta.appendChild(time);
    }

    wrap.appendChild(meta);
    if (message.role === 'user') row.append(wrap, avatar);
    else row.append(avatar, wrap);
    return row;
  }

  function syncView() {
    const hasMessages = state.messages.length > 0;
    els.welcome.hidden = hasMessages;
    els.messageList.hidden = !hasMessages;
    updateClearState();
    updateJumpLatest();
  }

  function renderMessages() {
    const nearBottom = isNearBottom();
    const fragment = document.createDocumentFragment();
    state.messages.forEach((message, index) => {
      fragment.appendChild(buildMessageElement(message, index));
    });
    els.messageList.replaceChildren(fragment);
    syncView();
    if (nearBottom) scrollToBottom({ smooth: false });
  }

  // ------------------------------------------------------------------------
  // Typing indicator
  // ------------------------------------------------------------------------

  function showTyping() {
    els.typingText.textContent = TYPING_PHRASES[0];
    typingIndex = 0;
    els.typingRow.hidden = false;
    clearInterval(typingTimer);
    typingTimer = setInterval(() => {
      typingIndex = (typingIndex + 1) % TYPING_PHRASES.length;
      els.typingText.textContent = TYPING_PHRASES[typingIndex];
    }, 2400);
    scrollToBottom({ smooth: true, force: true });
  }

  function hideTyping() {
    clearInterval(typingTimer);
    typingTimer = null;
    els.typingRow.hidden = true;
  }

  // ------------------------------------------------------------------------
  // Composer state
  // ------------------------------------------------------------------------

  function autoGrow() {
    const input = els.messageInput;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 164)}px`;
  }

  function attachmentReady() {
    return Boolean(state.attachment && state.attachment.status === 'ready' && state.attachment.id);
  }

  function updateComposer() {
    const length = els.messageInput.value.length;
    const ready = attachmentReady();
    const canSend = !state.busy && (length > 0 || ready);

    els.sendBtn.disabled = !canSend;
    els.attachBtn.disabled = state.busy;
    els.attachBtn.hidden = !state.imageUploadsEnabled;
    els.removeAttachment.disabled = state.busy;

    els.sendBtn.classList.toggle('is-busy', state.busy);
    const use = els.sendBtn.querySelector('use');
    if (use) use.setAttribute('href', state.busy ? '#i-refresh' : '#i-send');
    els.composer.classList.toggle('is-busy', state.busy);

    els.charCount.textContent = `${length} / ${state.maxChars}`;
    els.charCount.classList.toggle('is-near', length > state.maxChars * 0.9);
    els.charCount.classList.toggle('is-over', length >= state.maxChars);
    updateClearState();
  }

  function updateClearState() {
    const hasContent = state.messages.length > 0 || Boolean(state.attachment);
    els.clearBtn.disabled = !hasContent || state.busy;
  }

  function setBusy(value) {
    state.busy = value;
    updateComposer();
  }

  function clearDraft() {
    els.messageInput.value = '';
    autoGrow();
    updateComposer();
  }

  // ------------------------------------------------------------------------
  // Attachments
  // ------------------------------------------------------------------------

  function updateAttachmentView() {
    const attachment = state.attachment;
    if (!attachment) {
      els.attachmentPreview.hidden = true;
      return;
    }

    els.attachmentPreview.hidden = false;
    els.attachmentThumb.src = attachment.previewUrl;
    els.attachmentName.textContent = attachment.name || 'image';

    els.attachmentStatus.className = 'attachment-status';
    if (attachment.status === 'uploading') {
      els.attachmentStatus.textContent = `Uploading… ${attachment.progress || 0}%`;
      els.uploadProgress.hidden = false;
      els.uploadProgressBar.style.width = `${attachment.progress || 0}%`;
    } else if (attachment.status === 'ready') {
      const details = [formatBytes(attachment.size)];
      if (attachment.width && attachment.height) {
        details.push(`${attachment.width}×${attachment.height}`);
      }
      els.attachmentStatus.textContent = `Ready to analyze${details.length ? ` · ${details.join(' · ')}` : ''}`;
      els.attachmentStatus.classList.add('is-ready');
      els.uploadProgress.hidden = true;
    } else {
      els.attachmentStatus.textContent = 'Upload failed. Remove it and try another image.';
      els.attachmentStatus.classList.add('is-error');
      els.uploadProgress.hidden = true;
    }
  }

  function deleteRemoteAttachment(id) {
    if (!id) return;
    fetch(`/api/attachments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Client-Id': state.clientId },
    }).catch(() => {
      // The server also expires images automatically.
    });
  }

  function clearAttachment({ deleteRemote = false, silent = true } = {}) {
    state.uploadSeq += 1;
    const attachment = state.attachment;
    if (!attachment) {
      updateAttachmentView();
      updateComposer();
      return;
    }
    if (attachment.xhr) {
      try {
        attachment.xhr.abort();
      } catch {
        // Ignore.
      }
    }
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    if (deleteRemote && attachment.id) deleteRemoteAttachment(attachment.id);
    state.attachment = null;
    els.fileInput.value = '';
    updateAttachmentView();
    updateComposer();
    if (!silent) showToast('Image removed.', 'info', 2200);
  }

  function markUploadError(message) {
    if (!state.attachment) return;
    state.attachment.status = 'error';
    state.attachment.xhr = null;
    updateAttachmentView();
    updateComposer();
    showToast(message, 'error', 5000);
  }

  function uploadFile(file, sequence) {
    const xhr = new XMLHttpRequest();
    state.attachment.xhr = xhr;

    const form = new FormData();
    form.append('image', file, file.name);

    xhr.open('POST', '/api/attachments', true);
    xhr.setRequestHeader('X-Client-Id', state.clientId);
    xhr.timeout = 90000;

    xhr.upload.onprogress = (event) => {
      if (sequence !== state.uploadSeq || !state.attachment) return;
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100)));
      state.attachment.progress = percent;
      if (state.attachment.status === 'uploading') {
        els.uploadProgressBar.style.width = `${percent}%`;
        els.attachmentStatus.textContent = `Uploading… ${percent}%`;
      }
    };

    xhr.onload = () => {
      if (sequence !== state.uploadSeq) {
        // The user removed the image while it was uploading. Clean up the
        // temporary server copy instead of leaving it to expire.
        try {
          const stale = JSON.parse(xhr.responseText);
          if (stale && stale.attachment && stale.attachment.id) {
            deleteRemoteAttachment(stale.attachment.id);
          }
        } catch {
          // Ignore malformed responses.
        }
        return;
      }
      if (!state.attachment) return;

      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && data && data.attachment) {
        const attachment = data.attachment;
        state.attachment = {
          ...state.attachment,
          id: attachment.id,
          name: attachment.name || state.attachment.name,
          width: attachment.width,
          height: attachment.height,
          size: attachment.size,
          status: 'ready',
          progress: 100,
          xhr: null,
        };
        updateAttachmentView();
        updateComposer();
        return;
      }

      const message =
        (data && data.error && data.error.message) ||
        (xhr.status === 413
          ? 'That image is too large. Try a smaller image.'
          : 'The image upload failed. Please try again.');
      markUploadError(message);
    };

    xhr.onerror = () => {
      if (sequence !== state.uploadSeq) return;
      markUploadError('I couldn’t upload the image. Check the server connection and try again.');
    };

    xhr.ontimeout = () => {
      if (sequence !== state.uploadSeq) return;
      markUploadError('The image upload took too long. Please try again.');
    };

    xhr.onabort = () => {
      // Removing the attachment intentionally aborts the request.
    };

    xhr.send(form);
  }

  function handleFile(file) {
    if (!file) return;
    if (state.busy) {
      showToast('Wait for the current answer before changing the image.', 'info');
      return;
    }

    const maxMb = Number(state.meta?.limits?.maxImageMb) || 6;
    const type = String(file.type || '').toLowerCase();
    const extension = String(file.name.split('.').pop() || '').toLowerCase();
    const typeAllowed =
      ALLOWED_IMAGE_TYPES.has(type) || (type === '' && ALLOWED_IMAGE_EXTENSIONS.has(extension));

    if (!typeAllowed) {
      showToast('Choose a JPEG, PNG, or WebP image.', 'error');
      els.fileInput.value = '';
      return;
    }
    if (file.size === 0) {
      showToast('That image file is empty. Choose another one.', 'error');
      els.fileInput.value = '';
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      showToast(`That image is larger than ${maxMb} MB. Choose a smaller image.`, 'error');
      els.fileInput.value = '';
      return;
    }

    clearAttachment({ deleteRemote: true });
    const sequence = state.uploadSeq;
    state.attachment = {
      previewUrl: URL.createObjectURL(file),
      name: file.name || 'image',
      size: file.size,
      status: 'uploading',
      progress: 0,
      id: null,
      width: null,
      height: null,
      xhr: null,
    };
    updateAttachmentView();
    updateComposer();
    uploadFile(file, sequence);
  }

  // ------------------------------------------------------------------------
  // Sending
  // ------------------------------------------------------------------------

  function buildHistory() {
    return state.messages
      .filter(
        (message) =>
          (message.role === 'user' || (message.role === 'assistant' && !message.error)) &&
          typeof message.content === 'string' &&
          message.content.trim()
      )
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 2000),
      }));
  }

  function markAiVerified() {
    if (state.demoMode) return;
    state.aiVerified = true;
    applyModeState();
  }

  async function submitQuestion(rawText, options = {}) {
    if (!state.termsAccepted) return;
    if (state.busy) return;

    const text =
      String(rawText || '').trim() ||
      (attachmentReady() || options.attachmentId ? DEFAULT_IMAGE_QUESTION : '');
    if (!text) return;

    if (state.attachment && state.attachment.status === 'uploading') {
      showToast('Wait for the image to finish uploading.', 'info');
      return;
    }

    const attachmentId =
      options.attachmentId ||
      (attachmentReady() && state.attachment ? state.attachment.id : null);
    const attachmentName =
      options.attachmentName ||
      (attachmentId && state.attachment && state.attachment.id === attachmentId
        ? state.attachment.name
        : null);

    const history = buildHistory();
    const userMessage = {
      id: makeId(),
      role: 'user',
      content: text,
      attachmentName,
      createdAt: Date.now(),
    };

    state.messages.push(userMessage);
    clearDraft();
    setBusy(true);
    renderMessages();
    scrollToBottom({ smooth: true, force: true });
    showTyping();
    showSourceSkeleton();

    const payload = { message: text, history };
    if (attachmentId) payload.attachmentId = attachmentId;
    if (state.preferExcerpts) payload.preferExcerpts = true;

    let liveMessage = null;
    let pendingSources = [];
    let pendingWarnings = [];
    let pendingSafety = null;
    let pendingImage = null;
    let pendingFollowUps = [];
    let pendingConfidence = null;
    let renderQueued = false;

    const queueRender = () => {
      if (renderQueued) return;
      renderQueued = true;
      setTimeout(() => {
        renderQueued = false;
        renderMessages();
      }, 80);
    };

    try {
      const response = await streamChat(payload, {
        onSources: (data) => {
          pendingSources = Array.isArray(data.sources) ? data.sources : [];
          pendingWarnings = Array.isArray(data.warnings) ? data.warnings : [];
          pendingSafety = data.safety || null;
          pendingImage = data.image || null;
          pendingFollowUps = Array.isArray(data.followUps) ? data.followUps : [];
          pendingConfidence = data.confidence || data.meta?.confidence?.level || null;
          if (!els.typingRow.hidden) els.typingText.textContent = 'Writing the answer…';
        },
        onDelta: (chunk) => {
          if (!chunk) return;
          if (!liveMessage) {
            hideTyping();
            hideSourceSkeleton();
            liveMessage = {
              id: makeId(),
              role: 'assistant',
              content: '',
              question: text,
              sources: pendingSources,
              warnings: pendingWarnings,
              safety: pendingSafety,
              image: pendingImage,
              followUps: pendingFollowUps,
              confidence: pendingConfidence,
              mode: 'ai',
              aiGenerated: true,
              streaming: true,
              attachmentId: attachmentId || null,
              createdAt: Date.now(),
            };
            state.messages.push(liveMessage);
          }
          liveMessage.content += chunk;
          queueRender();
        },
      });

      const answer = {
        // Keep the id used while streaming so the finished message does not
        // replay its entry animation.
        id: (liveMessage && liveMessage.id) || response.id || makeId(),
        question: text,
        content:
          String(response.answer || '').trim() || 'The server returned an empty answer.',
        sources: Array.isArray(response.sources) ? response.sources : [],
        warnings: Array.isArray(response.warnings) ? response.warnings : [],
        safety: response.safety || null,
        image: response.image || null,
        followUps: Array.isArray(response.followUps) ? response.followUps : pendingFollowUps,
        confidence: response.confidence || response.meta?.confidence?.level || pendingConfidence,
        mode: response.mode || (response.aiGenerated ? 'ai' : 'guide'),
        aiGenerated: Boolean(response.aiGenerated),
        attachmentId: attachmentId || null,
      };

      if (liveMessage) {
        Object.assign(liveMessage, answer, { streaming: false });
      } else {
        state.messages.push({ ...answer, role: 'assistant', createdAt: Date.now() });
      }
      if (answer.mode === 'ai' && answer.aiGenerated) markAiVerified();
      if (attachmentId) clearAttachment({ deleteRemote: true });
    } catch (error) {
      if (liveMessage) {
        liveMessage.streaming = false;
        liveMessage.retryable = true;
        if (liveMessage.content) {
          // Keep the part that already arrived, but label it as incomplete.
          liveMessage.interrupted = true;
          liveMessage.warnings = [
            ...(liveMessage.warnings || []),
            error.message || 'The answer was interrupted before it finished.',
          ];
        } else {
          liveMessage.error = true;
          liveMessage.content =
            error.message ||
            'Something went wrong while preparing the answer. Please try again.';
        }
      } else {
        const assistantMessage = {
          id: makeId(),
          role: 'assistant',
          error: true,
          content:
            error.message ||
            'Something went wrong while preparing the answer. Please try again.',
          retryable: true,
          attachmentId: attachmentId || null,
          createdAt: Date.now(),
        };
        state.messages.push(assistantMessage);
      }

      if (error.code === 'attachment_expired' || error.code === 'invalid_attachment_id') {
        clearAttachment({ deleteRemote: false });
      }
      if (error.code === 'rate_limited') {
        showToast('Slow down a little, then try again.', 'info');
      }
    } finally {
      hideTyping();
      hideSourceSkeleton();
      setBusy(false);
      renderMessages();
      scrollToBottom({ smooth: true, force: true });
      if (window.matchMedia('(min-width: 961px)').matches) {
        els.messageInput.focus();
      }
    }
  }

  function askSuggestion(question) {
    if (state.busy) {
      showToast('Give me a moment to finish the current answer.', 'info');
      return;
    }
    closeSidebar();
    els.messageInput.value = question;
    autoGrow();
    updateComposer();
    submitQuestion(question);
  }

  async function retryMessage(messageId) {
    if (state.busy) return;
    const errorIndex = state.messages.findIndex((message) => message.id === messageId);
    if (errorIndex < 0) return;
    const target = state.messages[errorIndex];
    if (!target || target.role !== 'assistant') return;

    let userIndex = errorIndex - 1;
    while (userIndex >= 0 && state.messages[userIndex].role !== 'user') userIndex -= 1;
    if (userIndex < 0) {
      showToast('I could not find the original question to retry.', 'error');
      return;
    }

    const userMessage = state.messages[userIndex];
    let attachmentId = null;
    if (
      target.attachmentId &&
      state.attachment &&
      state.attachment.status === 'ready' &&
      state.attachment.id === target.attachmentId
    ) {
      attachmentId = target.attachmentId;
    } else if (target.attachmentId) {
      showToast('The image is no longer available. Retrying with text only.', 'info');
    }

    state.messages.splice(userIndex);
    renderMessages();
    await submitQuestion(userMessage.content, {
      attachmentId,
      attachmentName: userMessage.attachmentName || null,
    });
  }

  async function copyMessage(messageId) {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) return;

    const lines = [String(message.content || '')];
    const hasSources = Array.isArray(message.sources) && message.sources.length > 0;
    if (hasSources) {
      lines.push('', 'Sources (STI High School Student Handbook):');
      message.sources.forEach((source, index) => {
        const pdf = Number.isFinite(Number(source.pdfPage)) ? ` · PDF p. ${source.pdfPage}` : '';
        lines.push(`${index + 1}. ${source.section || 'Section'} — ${formatPage(source)}${pdf}`);
      });
    }
    const text = lines.join('\n').trim();
    const successMessage = hasSources
      ? 'Answer copied with its sources.'
      : 'Answer copied to the clipboard.';

    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage, 'success', 2400);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        showToast(successMessage, 'success', 2400);
      } catch {
        showToast('Copying is not available in this browser.', 'error');
      } finally {
        area.remove();
      }
    }
  }

  // ------------------------------------------------------------------------
  // About and clearing
  // ------------------------------------------------------------------------

  function aboutHtml() {
    const handbook = state.meta?.handbook;
    const mode = state.demoMode;

    let modeText;
    if (mode === true) {
      modeText = `<strong>Local demo mode.</strong> No AI provider is configured, so no question or image is sent to an AI service. Answers are direct excerpts from the indexed handbook and are clearly labelled “not AI”.`;
    } else if (mode === false) {
      const provider = state.meta?.provider?.provider || 'the configured provider';
      const model = state.meta?.provider?.chatModel || 'the configured model';
      modeText = `<strong>AI mode is configured.</strong> Your question, recent conversation, and the retrieved handbook passages are sent to <code>${escapeHtml(
        provider
      )}</code> using <code>${escapeHtml(
        model
      )}</code>. A badge saying “AI verified” appears only after a successful AI response in this browser session.`;
    } else {
      modeText = `<strong>Server status unknown.</strong> The page could not load the current mode from the server. Reload after starting the server.`;
    }

    const ttl = state.meta?.limits?.attachmentTtlMinutes || 30;
    const pages = handbook?.pagesIndexed
      ? `pp. ${handbook.pagesIndexed.from}–${handbook.pagesIndexed.to}`
      : 'the student-policy chapters';

    return `
      <div class="modal-callout">
        <strong>Unofficial prototype.</strong> STI Assist AI is not affiliated with or endorsed by STI. Answers can be incomplete or wrong. Always confirm important rules with your school office.
      </div>

      <h3>What this assistant does</h3>
      <p>
        It searches an index of the <strong>${escapeHtml(
          handbook?.title || 'STI High School Student Handbook'
        )}</strong>${handbook?.published ? ` (published ${escapeHtml(handbook.published)})` : ''}
        and answers questions about school policy. Indexed content covers ${escapeHtml(
          pages
        )}; citations use the handbook’s printed page numbers.
      </p>

      <h3>How answers are produced</h3>
      <ol>
        <li>Your question is checked for scope and safety.</li>
        <li>The relevant handbook passages are retrieved with a hybrid keyword and semantic search.</li>
        <li>In AI mode, the passages and your question are sent to the configured model, with instructions to answer only from those passages and cite them.</li>
        <li>In demo mode, the passages are shown directly with no AI call.</li>
      </ol>

      <h3>Verifying citations</h3>
      <p>
        When the handbook PDF is available on this deployment, each source card links directly to the cited page. Printed page 39 is PDF page 40. If the PDF is not served, the source cards still show the retrieved excerpt.
      </p>

      <h3>Current mode</h3>
      <p>${modeText}</p>

      <h3>What is sent and stored</h3>
      <ul>
        <li><strong>Questions:</strong> your message and up to the last few conversation turns are sent to the local server. In AI mode they are also sent to the configured AI provider, subject to that provider’s terms and privacy policy.</li>
        <li><strong>Images:</strong> an uploaded image is held in the server’s memory for up to ${escapeHtml(
          String(ttl)
        )} minutes, then deleted. This app does not write images to disk. In AI mode the image is also sent to the vision model for transcription and description.</li>
        <li><strong>Conversations:</strong> messages live only in this browser tab and disappear on refresh or when you start a new chat.</li>
        <li><strong>Unanswered questions:</strong> when no handbook passage clearly answers a question, the question text may be recorded (without your client identifier, IP address, or conversation history) so the site operator can find gaps in the handbook coverage. Obvious emails and long numbers are removed, and entries expire automatically.</li>
        <li><strong>Browser storage:</strong> a random client identifier is kept in local storage so the server can match your image uploads to this browser, along with your theme choice and your Terms of use acceptance (version and date). No account or profile is created.</li>
      </ul>

      <h3>Safety boundaries</h3>
      <p>
        The assistant refuses requests for instructions on weapons, hiding weapons, bypassing security, violence, threats, self-harm, cheating, or evading school rules. Safety guidance is not a substitute for emergency services or professional care. In the Philippines, call <strong>911</strong> for immediate danger.
      </p>

      <h3>Limits</h3>
      <ul>
        <li>PDF extraction can miss or misread text; citations should be checked against the PDF.</li>
        <li>AI answers can hallucinate despite grounding instructions. Source cards show the retrieved passages so you can verify.</li>
        <li>Later official STI policies or campus-specific rules may supersede the handbook. Confirm with authorized school personnel.</li>
        <li>Uploaded images are supplementary context, not an official policy source.</li>
      </ul>
    `;
  }

  function showAbout() {
    openModal({
      title: 'About & privacy',
      body: aboutHtml(),
      actions: [{ label: 'Got it', variant: 'primary' }],
    });
  }

  // ------------------------------------------------------------------------
  // Terms of use
  // ------------------------------------------------------------------------

  // Bump TERMS_VERSION whenever the terms change materially: the gate then
  // reappears on every browser until the new version is accepted.
  const TERMS_VERSION = '1';
  const TERMS_STORAGE_KEY = 'sti-terms-accepted';

  function readTermsAcceptance() {
    try {
      const raw = window.localStorage.getItem(TERMS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === TERMS_VERSION) return parsed;
    } catch {
      /* Blocked storage or a corrupt value: ask again. */
    }
    return null;
  }

  function saveTermsAcceptance() {
    try {
      window.localStorage.setItem(
        TERMS_STORAGE_KEY,
        JSON.stringify({ version: TERMS_VERSION, acceptedAt: new Date().toISOString() })
      );
    } catch {
      /* Storage can be blocked; acceptance then lasts for this page only. */
    }
  }

  function termsHtml() {
    return `
      <div class="modal-callout">
        <strong>Please read before you continue.</strong> STI Assist AI is an unofficial student prototype, not an STI service, and its answers are not official school policy. By accepting, you agree to these terms.
      </div>

      <h3>What this assistant is</h3>
      <p>
        It searches an index of the printed STI High School Student Handbook and answers questions about school rules and services. It is a prototype: features may change, break, or be removed without notice.
      </p>

      <h3>Acceptable use</h3>
      <ul>
        <li>Ask about school policy and student life, and follow the same standards of conduct expected on campus.</li>
        <li>Do not use the assistant to cheat, harass or threaten anyone, plan or hide harm, or get around school rules or the law.</li>
        <li>Requests for weapons, violence, self-harm, cheating, or rule evasion are refused and may be replaced with safety guidance.</li>
      </ul>

      <h3>Answers can be wrong</h3>
      <p>
        Answers are written from handbook passages and, in AI mode, by an AI model. Both can miss or misread things, even when a page is cited. Always verify important rules with your adviser, the school office, or the official handbook. Later official announcements may supersede the handbook.
      </p>

      <h3>Your privacy</h3>
      <p>
        No account is created. Your question and recent conversation are sent to this app's server, and in AI mode to the configured AI provider, to write an answer. Uploaded images are held in server memory for a limited time and then deleted. Questions with no clear handbook answer may be logged anonymously to improve coverage. The “About &amp; privacy” panel explains what is sent and stored in full.
      </p>

      <h3>Safety</h3>
      <p>
        This is not an emergency or counseling service. In immediate danger, contact a trusted adult or school personnel, or call <strong>911</strong> (Philippines).
      </p>

      <h3>Changes and acceptance</h3>
      <p>
        These terms may be updated as the prototype evolves. When they change, the assistant asks you to accept the new version. Accepting stores only a version number and a date in this browser.
      </p>

      <p class="terms-meta">Terms version ${TERMS_VERSION} · effective 2 November 2026</p>
    `;
  }

  function acceptTerms() {
    state.termsAccepted = true;
    saveTermsAcceptance();
    forceCloseModal();
    showToast('Terms accepted. Ask about the handbook anytime.', 'success');
    if (window.matchMedia('(min-width: 961px)').matches) {
      els.messageInput.focus();
    }
  }

  function showTermsGate() {
    if (state.termsAccepted) return;
    const foot = openModal({
      title: 'Terms of use',
      locked: true,
      initialFocus: '#termsAgreeCheck',
      body: `${termsHtml()}
        <label class="terms-consent">
          <input type="checkbox" id="termsAgreeCheck" />
          <span>I have read and understood the Terms of use, and I accept them.</span>
        </label>`,
      actions: [
        {
          id: 'termsDeclineBtn',
          label: "I don't agree",
          variant: 'secondary',
          onClick: () => {
            showTermsDeclined();
            return false;
          },
        },
        {
          id: 'termsAgreeBtn',
          label: 'Agree and continue',
          variant: 'primary',
          disabled: true,
          onClick: () => {
            acceptTerms();
            return false;
          },
        },
      ],
    });

    const checkbox = els.modalBody.querySelector('#termsAgreeCheck');
    const agreeButton = foot.querySelector('#termsAgreeBtn');
    if (checkbox && agreeButton) {
      checkbox.addEventListener('change', () => {
        agreeButton.disabled = !checkbox.checked;
      });
    }
  }

  function showTermsDeclined() {
    openModal({
      title: 'Terms of use',
      locked: true,
      body: `
        <div class="modal-callout">
          <strong>You chose not to accept the Terms of use.</strong> The assistant cannot be used until they are accepted.
        </div>
        <p>
          You can review the terms again whenever you are ready. If you do not agree, close this tab to leave the assistant.
        </p>
      `,
      actions: [
        {
          id: 'termsReviewBtn',
          label: 'Review the terms',
          variant: 'primary',
          onClick: () => {
            showTermsGate();
            return false;
          },
        },
      ],
    });
  }

  function showTerms() {
    if (!state.termsAccepted) {
      showTermsGate();
      return;
    }
    const record = readTermsAcceptance();
    const acceptedAt = record?.acceptedAt ? new Date(record.acceptedAt) : null;
    const acceptedLabel =
      acceptedAt && !Number.isNaN(acceptedAt.getTime())
        ? acceptedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
    openModal({
      title: 'Terms of use',
      body: `${termsHtml()}${
        acceptedLabel
          ? `<p class="terms-meta">Accepted in this browser on ${escapeHtml(acceptedLabel)}.</p>`
          : ''
      }`,
      actions: [{ label: 'Close', variant: 'primary' }],
    });
  }

  function clearConversation() {
    if (state.busy) {
      showToast('Wait for the current answer before clearing the chat.', 'info');
      return;
    }
    state.messages = [];
    state.animatedIds.clear();
    clearAttachment({ deleteRemote: true });
    clearDraft();
    renderMessages();
    closeSidebar();
    if (window.matchMedia('(min-width: 961px)').matches) {
      els.messageInput.focus();
    }
  }

  function requestClear() {
    if (state.busy) {
      showToast('Wait for the current answer before clearing the chat.', 'info');
      return;
    }
    if (state.messages.length === 0 && !state.attachment) {
      closeSidebar();
      els.messageInput.focus();
      return;
    }

    openModal({
      title: 'Clear this conversation?',
      body: `
        <p>This removes every message from this browser tab and removes any attached image from the server.</p>
        <p>Conversations are not saved, so this cannot be undone.</p>
      `,
      actions: [
        { label: 'Cancel', variant: 'secondary' },
        {
          label: 'Clear conversation',
          variant: 'danger',
          onClick: () => {
            clearConversation();
          },
        },
      ],
    });
  }

  // ------------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------------

  // ------------------------------------------------------------------------
  // Handbook-only answers
  // ------------------------------------------------------------------------

  const EXCERPTS_KEY = 'sti-handbook-only';

  function updateExcerptsToggle() {
    const available = state.demoMode === false;
    els.excerptsToggle.hidden = !available;
    els.excerptsToggle.setAttribute('aria-pressed', String(state.preferExcerpts));
    els.excerptsToggle.title = state.preferExcerpts
      ? 'Handbook-only is on: answers are direct excerpts, never AI-written. Click to turn it off.'
      : 'Answer with direct handbook excerpts instead of an AI-written answer';
  }

  function setPreferExcerpts(value, { persist = true, announce = false } = {}) {
    state.preferExcerpts = Boolean(value);
    if (persist) {
      try {
        window.localStorage.setItem(EXCERPTS_KEY, state.preferExcerpts ? '1' : '0');
      } catch {
        /* Ignore blocked storage. */
      }
    }
    updateExcerptsToggle();
    if (announce) {
      showToast(
        state.preferExcerpts
          ? 'Handbook-only answers on: you will see direct excerpts, not AI-written text.'
          : 'Handbook-only answers off: replies are AI-written when available.',
        'info',
        3200
      );
    }
  }

  function readExcerptsPreference() {
    try {
      return window.localStorage.getItem(EXCERPTS_KEY) === '1';
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------------
  // Citation helpers
  // ------------------------------------------------------------------------

  // Turns "p. 39" / "pp. 39–40" text in an answer into buttons that reveal the
  // matching source card, so a citation can be checked without hunting.
  function enhanceCitations(root, sources, scope) {
    const pages = new Set(
      (Array.isArray(sources) ? sources : [])
        .map((source) => Number(source && source.page))
        .filter((page) => Number.isFinite(page))
    );
    if (pages.size === 0) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest('a, code, pre, button, .cite-link')) continue;
      if (/\bpp?\.\s*\d/.test(node.nodeValue || '')) nodes.push(node);
    }

    for (const node of nodes) {
      const text = node.nodeValue || '';
      const pattern = /\b(pp?\.\s*\d{1,3}(?:\s*[–-]\s*\d{1,3})?)/gi;
      const parts = [];
      let last = 0;
      let match;
      while ((match = pattern.exec(text))) {
        const numbers = (match[1].match(/\d{1,3}/g) || []).map(Number);
        const page = numbers.find((value) => pages.has(value));
        if (!page) continue;
        parts.push(document.createTextNode(text.slice(last, match.index)));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cite-link';
        button.dataset.page = String(page);
        button.dataset.scope = scope || '';
        button.title = `Show the source for printed page ${page}`;
        button.textContent = match[1];
        parts.push(button);
        last = match.index + match[1].length;
      }
      if (parts.length === 0) continue;
      parts.push(document.createTextNode(text.slice(last)));
      const fragment = document.createDocumentFragment();
      fragment.append(...parts);
      node.parentNode.replaceChild(fragment, node);
    }
  }

  function revealSourceForPage(page, scope) {
    const root = (scope && document.querySelector(`.message[data-id="${CSS.escape(scope)}"]`)) ||
      els.messageList;
    const card = root.querySelector(`.source-card[data-page="${CSS.escape(String(page))}"]`);
    if (!card) {
      showToast(`No source card for printed page ${page} in this answer.`, 'info', 2600);
      return;
    }
    card.open = true;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('is-highlighted');
    setTimeout(() => card.classList.remove('is-highlighted'), 1800);
  }

  // Highlights the words of the question inside a source excerpt.
  function questionTerms(question) {
    const words = String(question || '')
      .toLowerCase()
      .match(/[a-z]{4,}/g);
    if (!words) return [];
    return [...new Set(words)].slice(0, 8);
  }

  function highlightExcerpt(text, terms) {
    const fragment = document.createDocumentFragment();
    if (!terms || terms.length === 0) {
      fragment.appendChild(document.createTextNode(text));
      return fragment;
    }
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    text.split(pattern).forEach((part, index) => {
      if (!part) return;
      if (index % 2 === 1) {
        const mark = document.createElement('mark');
        mark.textContent = part;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });
    return fragment;
  }

  // ------------------------------------------------------------------------
  // Answer feedback
  // ------------------------------------------------------------------------

  async function sendFeedback(messageId, verdict) {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message || message.role !== 'assistant') return;
    if (message.feedback === verdict) {
      message.feedback = null;
    } else {
      message.feedback = verdict;
    }
    renderMessages();

    if (!message.feedback) return;
    const firstSource = Array.isArray(message.sources) ? message.sources[0] : null;
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          verdict: message.feedback,
          section: firstSource?.section || '',
          page: Number.isFinite(Number(firstSource?.page)) ? Number(firstSource.page) : null,
          mode: message.mode || 'guide',
        }),
        timeout: 8000,
      });
      showToast(
        message.feedback === 'helpful'
          ? 'Thanks — that helps tune retrieval.'
          : 'Thanks — that tells us this answer needs work.',
        'success',
        2600
      );
    } catch {
      showToast('The feedback could not be recorded. It is not required for anything.', 'info', 3000);
    }
  }

  // ------------------------------------------------------------------------
  // Source skeleton
  // ------------------------------------------------------------------------

  function showSourceSkeleton() {
    if (els.sourceSkeleton && state.messages.every((message) => !message.sources?.length)) {
      els.sourceSkeleton.hidden = false;
    }
  }

  function hideSourceSkeleton() {
    if (els.sourceSkeleton) els.sourceSkeleton.hidden = true;
  }

  // ------------------------------------------------------------------------
  // Table of contents (sidebar)
  // ------------------------------------------------------------------------

  let tocLoaded = false;

  function renderToc(toc) {
    const chapters = Array.isArray(toc?.chapters) ? toc.chapters : [];
    els.tocList.replaceChildren();
    if (chapters.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'toc-hint';
      hint.textContent = 'No sections were found in the index.';
      els.tocList.appendChild(hint);
      return;
    }

    const openUrl = state.meta?.handbook?.openUrl;
    const offset = Number(state.meta?.handbook?.pdfPageOffset);
    const pageOffset = Number.isFinite(offset) ? offset : 1;

    chapters.forEach((chapter) => {
      const heading = document.createElement('p');
      heading.className = 'toc-chapter';
      heading.textContent = chapter.chapter;
      els.tocList.appendChild(heading);

      (chapter.sections || []).forEach((section) => {
        const page = Number(section.page);
        const item = openUrl && Number.isFinite(page)
          ? document.createElement('a')
          : document.createElement('button');
        item.className = 'toc-item';
        if (item.tagName === 'A') {
          item.href = `${openUrl}#page=${page + pageOffset}`;
          item.target = '_blank';
          item.rel = 'noopener noreferrer';
        } else {
          item.type = 'button';
          item.dataset.question = `What does the handbook say about ${section.section}?`;
        }
        const label = document.createElement('span');
        label.textContent = section.section;
        const pageLabel = document.createElement('span');
        pageLabel.className = 'toc-page';
        pageLabel.textContent = Number.isFinite(page)
          ? Number(section.pageEnd) > page
            ? `pp. ${page}–${section.pageEnd}`
            : `p. ${page}`
          : '';
        item.append(label, pageLabel);
        els.tocList.appendChild(item);
      });
    });
  }

  async function loadToc() {
    if (tocLoaded) return;
    tocLoaded = true;
    try {
      const toc = await apiFetch('/api/handbook/sections', { timeout: 15000 });
      renderToc(toc);
    } catch {
      tocLoaded = false;
      els.tocList.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'toc-hint';
      hint.textContent = 'The section list could not be loaded. Open this again to retry.';
      els.tocList.appendChild(hint);
    }
  }

  // ------------------------------------------------------------------------
  // Command palette
  // ------------------------------------------------------------------------

  let paletteIndex = 0;
  let paletteMatches = [];

  function paletteActions() {
    const actions = [
      {
        label: 'New chat',
        kind: 'Action',
        icon: 'plus',
        run: () => requestClear(),
      },
      {
        label: 'Focus the question box',
        kind: 'Action',
        icon: 'chat',
        run: () => els.messageInput.focus(),
      },
      {
        label: 'Theme: follow system',
        kind: 'Theme',
        icon: 'monitor',
        run: () => applyThemeChoice('system'),
      },
      {
        label: 'Theme: light',
        kind: 'Theme',
        icon: 'sun',
        run: () => applyThemeChoice('light'),
      },
      {
        label: 'Theme: dark',
        kind: 'Theme',
        icon: 'moon',
        run: () => applyThemeChoice('dark'),
      },
      {
        label: state.preferExcerpts ? 'Turn off handbook-only answers' : 'Turn on handbook-only answers',
        kind: 'Action',
        icon: 'book',
        when: () => state.demoMode === false,
        run: () => setPreferExcerpts(!state.preferExcerpts, { announce: true }),
      },
      {
        label: 'Print or save this conversation as PDF',
        kind: 'Action',
        icon: 'file',
        run: () => window.print(),
      },
      state.meta?.handbook?.openUrl
        ? {
            label: 'Open the handbook PDF',
            kind: 'Handbook',
            icon: 'book',
            run: () => window.open(state.meta.handbook.openUrl, '_blank', 'noopener'),
          }
        : null,
      {
        label: 'About & privacy',
        kind: 'Action',
        icon: 'info',
        run: () => showAbout(),
      },
      {
        label: 'Terms of use',
        kind: 'Action',
        icon: 'shield',
        run: () => showTerms(),
      },
    ].filter(Boolean);

    const suggestions = normaliseSuggestions(state.meta?.suggestedQuestions);
    suggestions.forEach((item) => {
      actions.push({
        label: item.label,
        detail: item.question,
        kind: 'Suggested',
        icon: item.icon,
        run: () => askSuggestion(item.question),
      });
    });
    return actions;
  }

  function renderPalette(query = '') {
    const needle = query.trim().toLowerCase();
    paletteMatches = paletteActions().filter((action) => {
      if (action.when && !action.when()) return false;
      if (!needle) return true;
      return `${action.label} ${action.detail || ''}`.toLowerCase().includes(needle);
    });
    paletteIndex = 0;
    els.paletteList.replaceChildren();

    if (paletteMatches.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching action.';
      els.paletteList.appendChild(empty);
      return;
    }

    paletteMatches.forEach((action, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.setAttribute('role', 'option');
      button.dataset.index = String(index);
      if (index === paletteIndex) button.classList.add('is-active');
      button.appendChild(iconEl(action.icon || 'info'));
      const text = document.createElement('span');
      text.textContent = action.label;
      button.appendChild(text);
      const kind = document.createElement('span');
      kind.className = 'palette-kind';
      kind.textContent = action.kind;
      button.appendChild(kind);
      item.appendChild(button);
      els.paletteList.appendChild(item);
    });
  }

  function movePalette(step) {
    if (paletteMatches.length === 0) return;
    paletteIndex = (paletteIndex + step + paletteMatches.length) % paletteMatches.length;
    els.paletteList.querySelectorAll('.palette-item').forEach((button, index) => {
      button.classList.toggle('is-active', index === paletteIndex);
    });
    els.paletteList.querySelector('.palette-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function runPalette(index) {
    const action = paletteMatches[index];
    if (!action) return;
    closePalette();
    action.run();
  }

  function openPalette() {
    if (!state.termsAccepted) return;
    closeModal();
    setThemeMenuOpen(false);
    els.paletteBackdrop.hidden = false;
    els.paletteInput.value = '';
    renderPalette('');
    els.paletteInput.focus();
  }

  function closePalette({ restoreFocus = false } = {}) {
    if (els.paletteBackdrop.hidden) return;
    els.paletteBackdrop.hidden = true;
    if (restoreFocus) els.messageInput.focus();
  }

  // ------------------------------------------------------------------------
  // Dictation (progressive enhancement)
  // ------------------------------------------------------------------------

  function setupVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    els.micBtn.hidden = false;

    let recognition = null;
    let recording = false;

    const stop = () => {
      recording = false;
      els.micBtn.classList.remove('is-recording');
      els.micBtn.setAttribute('aria-label', 'Dictate a question');
    };

    els.micBtn.addEventListener('click', () => {
      if (recording) {
        recognition?.stop();
        return;
      }
      recognition = new Recognition();
      recognition.lang = 'en-PH';
      recognition.interimResults = true;
      recognition.continuous = false;
      const base = els.messageInput.value.trim() ? `${els.messageInput.value.trim()} ` : '';

      recognition.onresult = (event) => {
        let transcript = '';
        for (const result of event.results) transcript += result[0].transcript;
        els.messageInput.value = `${base}${transcript}`.slice(0, state.maxChars);
        autoGrow();
        updateComposer();
      };
      recognition.onerror = (event) => {
        stop();
        showToast(
          event.error === 'not-allowed'
            ? 'Microphone access was blocked. Allow it in the browser, then try again.'
            : 'Dictation stopped before it heard anything.',
          'info',
          3400
        );
      };
      recognition.onend = stop;

      recording = true;
      els.micBtn.classList.add('is-recording');
      els.micBtn.setAttribute('aria-label', 'Stop dictation');
      try {
        recognition.start();
      } catch {
        stop();
      }
    });
  }

  // ------------------------------------------------------------------------
  // Mobile keyboard height
  // ------------------------------------------------------------------------

  function watchViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const keyboardOpen = window.innerHeight - vv.height > 120;
      document.documentElement.style.setProperty(
        '--app-height',
        keyboardOpen ? `${Math.round(vv.height)}px` : ''
      );
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }

  function bindEvents() {
    els.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      if (state.busy) return;
      const text = els.messageInput.value.trim();
      if (!text && !attachmentReady()) {
        els.messageInput.focus();
        return;
      }
      if (state.attachment && state.attachment.status === 'uploading') {
        showToast('Wait for the image to finish uploading.', 'info');
        return;
      }
      submitQuestion(text);
    });

    els.messageInput.addEventListener('input', () => {
      autoGrow();
      updateComposer();
    });

    els.messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!els.sendBtn.disabled) els.composer.requestSubmit();
      }
    });

    els.messageInput.addEventListener('paste', (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            handleFile(file);
            return;
          }
        }
      }
    });

    els.attachBtn.addEventListener('click', () => {
      if (!state.busy && state.imageUploadsEnabled) els.fileInput.click();
    });

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      // Reset the input so choosing the same file again still fires "change".
      els.fileInput.value = '';
      handleFile(file);
    });

    els.removeAttachment.addEventListener('click', () => {
      if (state.busy) return;
      clearAttachment({ deleteRemote: true, silent: false });
    });

    // Drag and drop onto the composer.
    ['dragenter', 'dragover'].forEach((type) => {
      els.composer.addEventListener(type, (event) => {
        if (state.busy) return;
        event.preventDefault();
        els.composer.classList.add('is-dragging');
      });
    });
    ['dragleave', 'dragend'].forEach((type) => {
      els.composer.addEventListener(type, () => {
        els.composer.classList.remove('is-dragging');
      });
    });
    els.composer.addEventListener('drop', (event) => {
      event.preventDefault();
      els.composer.classList.remove('is-dragging');
      if (state.busy) return;
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    els.sidebarSuggestions.addEventListener('click', (event) => {
      const button = event.target.closest('[data-question]');
      if (button) askSuggestion(button.dataset.question);
    });

    els.startCards.addEventListener('click', (event) => {
      const button = event.target.closest('[data-question]');
      if (button) askSuggestion(button.dataset.question);
    });

    els.messageList.addEventListener('click', (event) => {
      const citation = event.target.closest('.cite-link');
      if (citation) {
        revealSourceForPage(citation.dataset.page, citation.dataset.scope);
        return;
      }
      const chip = event.target.closest('.follow-up[data-question]');
      if (chip) {
        askSuggestion(chip.dataset.question);
        return;
      }
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'copy') copyMessage(button.dataset.id);
      if (button.dataset.action === 'retry') retryMessage(button.dataset.id);
      if (button.dataset.action === 'vote-up') sendFeedback(button.dataset.id, 'helpful');
      if (button.dataset.action === 'vote-down') sendFeedback(button.dataset.id, 'not_helpful');
    });

    els.chatScroll.addEventListener('scroll', updateJumpLatest, { passive: true });
    els.jumpLatest.addEventListener('click', () => {
      scrollToBottom({ smooth: true, force: true });
      updateJumpLatest();
    });

    els.menuBtn.addEventListener('click', () => {
      if (els.sidebar.classList.contains('is-open')) closeSidebar({ restoreFocus: true });
      else openSidebar();
    });
    els.sidebarClose.addEventListener('click', () => closeSidebar({ restoreFocus: true }));
    els.sidebarOverlay.addEventListener('click', () => closeSidebar({ restoreFocus: true }));

    els.newChatBtn.addEventListener('click', requestClear);
    els.brandBtn.addEventListener('click', requestClear);
    els.clearBtn.addEventListener('click', requestClear);

    els.themeBtn.addEventListener('click', () => setThemeMenuOpen(els.themeMenu.hidden));
    els.themeMenu.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-theme-choice]');
      if (!choice) return;
      applyThemeChoice(choice.dataset.themeChoice);
      setThemeMenuOpen(false);
      els.themeBtn.focus();
    });
    document.addEventListener('click', (event) => {
      if (els.themeMenu.hidden) return;
      if (!event.target.closest('.theme-control')) setThemeMenuOpen(false);
    });

    els.excerptsToggle.addEventListener('click', () =>
      setPreferExcerpts(!state.preferExcerpts, { announce: true })
    );

    els.paletteBtn.addEventListener('click', () => openPalette());
    els.paletteInput.addEventListener('input', () => renderPalette(els.paletteInput.value));
    els.paletteInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        movePalette(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        movePalette(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runPalette(paletteIndex);
      }
    });
    els.paletteList.addEventListener('click', (event) => {
      const item = event.target.closest('.palette-item');
      if (item) runPalette(Number(item.dataset.index));
    });
    els.paletteBackdrop.addEventListener('click', (event) => {
      if (event.target === els.paletteBackdrop) closePalette();
    });

    els.tocBlock.addEventListener('toggle', () => {
      if (els.tocBlock.open) loadToc();
    });
    els.tocList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-question]');
      if (button) {
        closeSidebar();
        askSuggestion(button.dataset.question);
      }
    });

    els.aboutBtn.addEventListener('click', showAbout);
    els.aboutLink.addEventListener('click', showAbout);
    els.termsLink.addEventListener('click', showTerms);
    els.termsBtn.addEventListener('click', showTerms);

    els.modalClose.addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', (event) => {
      if (event.target === els.modalBackdrop) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      // A locked gate owns the keyboard: Tab stays trapped inside it and no
      // shortcut (Ctrl+K, theme, Escape) can bypass it.
      if (!els.modalBackdrop.hidden && modalLocked) {
        if (event.key === 'Tab') trapModalFocus(event);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        if (els.paletteBackdrop.hidden) openPalette();
        else closePalette({ restoreFocus: true });
        return;
      }
      if (!els.paletteBackdrop.hidden) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closePalette({ restoreFocus: true });
        }
        return;
      }
      if (!els.themeMenu.hidden && event.key === 'Escape') {
        setThemeMenuOpen(false);
        els.themeBtn.focus();
        return;
      }
      if (!els.modalBackdrop.hidden) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeModal();
          return;
        }
        trapModalFocus(event);
        return;
      }
      if (event.key === 'Escape' && els.sidebar.classList.contains('is-open')) {
        closeSidebar({ restoreFocus: true });
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 960) closeSidebar();
    });

    window.addEventListener('beforeunload', () => {
      // Uploaded images expire on the server; revoke local previews.
      if (state.attachment && state.attachment.previewUrl) {
        URL.revokeObjectURL(state.attachment.previewUrl);
      }
    });
  }

  // ------------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------------

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* Offline support is optional; the app works without it. */
      });
    });
  }

  function init() {
    state.clientId = getClientId();
    state.termsAccepted = Boolean(readTermsAcceptance());
    initTheme();
    setPreferExcerpts(readExcerptsPreference(), { persist: false });
    setupVoiceInput();
    watchViewport();
    bindEvents();
    renderSuggestions(FALLBACK_SUGGESTIONS);
    applyModeState();
    updateComposer();
    // First visit (or a terms update): block everything until accepted.
    if (!state.termsAccepted) showTermsGate();
    loadMeta();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
