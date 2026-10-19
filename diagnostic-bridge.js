// ISOLATED world; registered at document_start. Unrelated tabs never start recording.
(() => {
  if (globalThis.__bugsnapSessionBridge) return;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''), eventName = `bugsnap-stream-${token}`;
  const inFlight = new Set();
  let sessionId = null, syncing = false, pending = [], disabled = false, overflow = 0;
  const stopPage = () => window.dispatchEvent(new CustomEvent(`${eventName}-control`, { detail: 'stop' }));
  const forward = payload => {
    const promise = chrome.runtime.sendMessage({ type: 'SESSION_EVENT', token, sessionId: payload.sessionId, category: payload.category, entry: payload.entry }).catch(() => { disabled = true; sessionId = null; stopPage(); });
    inFlight.add(promise); promise.finally(() => inFlight.delete(promise));
  };
  window.addEventListener(eventName, event => {
    if (disabled || typeof event.detail !== 'string' || event.detail.length > 20000) return;
    try {
      const payload = JSON.parse(event.detail);
      if (sessionId && payload.sessionId === sessionId) forward(payload);
      else if (syncing) { if (pending.length < 500) pending.push(payload); else overflow++; }
    } catch { /* Page-originated data is untrusted. */ }
  }, true);
  async function sync() {
    if (syncing || disabled) return;
    syncing = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SESSION_HELLO', token, pageDocumentId: `${performance.timeOrigin}`, title: document.title, environment: { browser: navigator.userAgent, platform: navigator.platform, width: innerWidth, height: innerHeight, dpr: devicePixelRatio } });
      sessionId = result?.active ? result.sessionId : null;
      if (sessionId) {
        for (const payload of pending) { if (payload.sessionId === sessionId) forward(payload); }
        if (overflow) forward({ sessionId, category: 'errors', entry: { id: `${token}:overflow-${Date.now()}`, kind: 'collector-warning', time: new Date().toISOString(), message: `接入期间缓冲超限，${overflow} 条事件未保存。`, pageUrl: location.href } });
      } else stopPage();
    } catch { sessionId = null; stopPage(); }
    finally { pending = []; overflow = 0; syncing = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'SESSION_SYNC') { void sync(); respond({ ok: true }); }
    if (message.type === 'SESSION_STOP') {
      stopPage(); sessionId = null; pending = [];
      Promise.allSettled([...inFlight]).then(() => respond({ ok: true })); return true;
    }
  });
  window.addEventListener('pageshow', () => { void sync(); });
  globalThis.__bugsnapSessionBridge = { sync };
  void sync();
})();
