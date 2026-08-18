(function () {
  'use strict';

  // === Paste your full base64 logo string below, replacing the placeholder ===
  const LOGO_SRC = "PASTE_YOUR_BASE64_HERE";

  // ---- Set logo on all logo-img elements ----
  function applyLogo() {
    document.querySelectorAll('.logo-img').forEach(function (img) {
      img.src = LOGO_SRC;
    });
  }
  applyLogo();

  // ---- Element refs ----
  const scrollArea    = document.getElementById('scrollArea');
  const welcome       = document.getElementById('welcome');
  const messagesEl    = document.getElementById('messages');
  const input         = document.getElementById('input');
  const sendBtn        = document.getElementById('sendBtn');
  const sendIcon       = document.getElementById('sendIcon');
  const stopIcon       = document.getElementById('stopIcon');
  const menuBtn        = document.getElementById('menuBtn');
  const closeSidebar   = document.getElementById('closeSidebar');
  const sidebar        = document.getElementById('sidebar');
  const overlay        = document.getElementById('overlay');
  const newChatBtn     = document.getElementById('newChatBtn');
  const sbNewChat      = document.getElementById('sbNewChat');
  const attachBtn      = document.getElementById('attachBtn');
  const fileInput      = document.getElementById('fileInput');
  const imgPreview     = document.getElementById('imgPreview');
  const imgPreviewThumb= document.getElementById('imgPreviewThumb');
  const imgRemove      = document.getElementById('imgRemove');
  const chips          = document.getElementById('chips');

  let chatHistory = [];      // [{role:'user'|'model', text:'...'}]
  let pendingImageBase64 = null;
  let isStreaming = false;
  let currentEventSource = null;

  // ---- Sidebar open/close ----
  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  }
  function closeSidebarFn() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }
  if (menuBtn) menuBtn.addEventListener('click', openSidebar);
  if (closeSidebar) closeSidebar.addEventListener('click', closeSidebarFn);
  if (overlay) overlay.addEventListener('click', closeSidebarFn);

  // ---- New chat ----
  function startNewChat() {
    chatHistory = [];
    messagesEl.innerHTML = '';
    messagesEl.classList.add('hidden');
    welcome.classList.remove('hidden');
    closeSidebarFn();
  }
  if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);
  if (sbNewChat) sbNewChat.addEventListener('click', startNewChat);

  // ---- Image attach ----
  if (attachBtn) attachBtn.addEventListener('click', function () {
    fileInput.click();
  });
  if (fileInput) fileInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      pendingImageBase64 = ev.target.result; // data:image/...;base64,....
      imgPreviewThumb.src = pendingImageBase64;
      imgPreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  if (imgRemove) imgRemove.addEventListener('click', function () {
    pendingImageBase64 = null;
    fileInput.value = '';
    imgPreview.classList.add('hidden');
  });

  // ---- Chips (quick prompts) ----
  if (chips) {
    chips.addEventListener('click', function (e) {
      const btn = e.target.closest('.chip-main');
      if (!btn) return;
      const map = {
        analyze: 'Analyze BTC for me',
        gainers: 'Show me today\'s top gainers',
        risk: 'Give me an ETH risk analysis',
        vs: 'Compare Bitcoin vs Ethereum'
      };
      const text = map[btn.dataset.chip];
      if (text) {
        input.value = text;
        sendMessage();
      }
    });
  }

  // ---- Auto-resize textarea + Enter to send ----
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // ---- Render a message bubble ----
  function renderMessage(role, text, isStreamingMsg) {
    welcome.classList.add('hidden');
    messagesEl.classList.remove('hidden');

    const wrap = document.createElement('div');
    wrap.className = 'msg-in flex ' + (role === 'user' ? 'justify-end' : 'justify-start');

    const bubble = document.createElement('div');
    bubble.className = (role === 'user'
      ? 'bg-[#6C63FF] text-white'
      : 'bg-surface text-[#e8e8e8]') +
      ' max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed md';

    if (isStreamingMsg) {
      bubble.classList.add('stream-cursor');
    }
    bubble.innerHTML = escapeHtml(text);

    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollArea.scrollTop = scrollArea.scrollHeight;
    return bubble;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  // ---- Typing indicator ----
  function renderTyping() {
    welcome.classList.add('hidden');
    messagesEl.classList.remove('hidden');
    const wrap = document.createElement('div');
    wrap.className = 'msg-in flex justify-start';
    wrap.id = 'typingIndicator';
    wrap.innerHTML = '<div class="bg-surface rounded-2xl px-4 py-3 flex gap-1">' +
      '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>';
    messagesEl.appendChild(wrap);
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }
  function removeTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
  }

  // ---- Send / Stop button toggle ----
  function setSendingState(sending) {
    isStreaming = sending;
    if (sending) {
      sendIcon.classList.add('hidden');
      stopIcon.classList.remove('hidden');
    } else {
      sendIcon.classList.remove('hidden');
      stopIcon.classList.add('hidden');
    }
  }

  // ---- Main send handler ----
  function sendMessage() {
    if (isStreaming) {
      // Acting as Stop
      if (currentEventSource) currentEventSource.close();
      setSendingState(false);
      removeTyping();
      return;
    }

    const text = input.value.trim();
    if (!text && !pendingImageBase64) return;

    renderMessage('user', text || '[Image]');
    chatHistory.push({ role: 'user', text: text });

    const imageToSend = pendingImageBase64;
    input.value = '';
    pendingImageBase64 = null;
    imgPreview.classList.add('hidden');
    fileInput.value = '';

    renderTyping();
    setSendingState(true);

    streamFromServer(text, imageToSend);
  }

  if (sendBtn) sendBtn.addEventListener('click', sendMessage);

  // ---- Talk to backend (streaming via GET /api/stream with SSE) ----
  function streamFromServer(message, imageBase64) {
    // Image uploads aren't supported by the GET-based SSE stream endpoint,
    // so if there's an image, go straight to the non-streaming /api/chat.
    if (imageBase64) {
      removeTyping();
      fallbackToChatEndpoint(message, imageBase64);
      return;
    }

    removeTyping();
    const bubble = renderMessage('model', '', true);
    let fullText = '';

    const params = new URLSearchParams({
      message: message,
      history: JSON.stringify(chatHistory.slice(0, -1))
    });
    const es = new EventSource('/api/stream?' + params.toString());
    currentEventSource = es;

    es.addEventListener('delta', function (e) {
      const data = JSON.parse(e.data);
      fullText += data.text;
      bubble.innerHTML = escapeHtml(fullText);
      scrollArea.scrollTop = scrollArea.scrollHeight;
    });

    es.addEventListener('done', function () {
      bubble.classList.remove('stream-cursor');
      chatHistory.push({ role: 'model', text: fullText });
      setSendingState(false);
      es.close();
    });

    es.addEventListener('error', function () {
      bubble.classList.remove('stream-cursor');
      setSendingState(false);
      es.close();
      if (!fullText) {
        bubble.remove();
        fallbackToChatEndpoint(message, imageBase64);
      }
    });
  }

  // ---- Fallback non-streaming endpoint (/api/chat) ----
  function fallbackToChatEndpoint(message, imageBase64) {
    renderTyping();
    setSendingState(true);
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: chatHistory.slice(0, -1),
        imageBase64: imageBase64 || null
      })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      removeTyping();
      setSendingState(false);
      const reply = data.reply || 'Sorry, no response.';
      renderMessage('model', reply);
      chatHistory.push({ role: 'model', text: reply });
    })
    .catch(function () {
      removeTyping();
      setSendingState(false);
      renderMessage('model', 'Error connecting to server. Please try again.');
    });
  }

})();