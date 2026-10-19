/** Runs in the page's MAIN world. All dependencies must remain inside this function. */
export function pageDiagnostics(action = 'read', options = {}) {
  const key = '__BUGSNAP_DIAGNOSTICS_V2__';
  const old = window[key];
  if (action === 'read') return old?.snapshot?.() || null;
  if (action === 'stop') { old?.stop?.(); return old?.snapshot?.() || null; }
  if (action === 'clear') { old?.clear?.(); return old?.snapshot?.() || null; }
  if (action !== 'start') return null;
  if (old?.snapshot?.().active) {
    if (!options.sessionId || (old.snapshot().sessionId === options.sessionId && old.snapshot().eventName === options.eventName)) return old.snapshot();
    old.stop();
  }
  const LIMIT = 100, MAX = 2000;
  const now = () => new Date().toISOString();
  const safeURL = value => {
    try { const url = new URL(String(value), location.href); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href.slice(0, MAX); }
    catch { return '[无法解析的地址]'; }
  };
  const text = value => {
    let result;
    if (value instanceof Error) result = `${value.name}: ${value.message}`;
    else if (value === null) result = 'null';
    else if (['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof value)) result = String(value);
    else result = '[Object]';
    return result.slice(0, MAX).replace(/\b(?:https?|file):\/\/[^\s)"'<>]+/gi, url => safeURL(url)).replace(/((?:password|token|secret|authorization|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]');
  };
  let sequence = 0, requestSequence = 0, nearbyAction = null, extraRedactor = value => value;
  const extra = { actions: [], feedback: [], network: [], navigation: [] }, stopListeners = [];
  const streamToken = options.eventName?.replace('bugsnap-stream-', '') || '';
  const runId = options.sessionId ? Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('') : '';
  let active = true, startedAt = now(), stoppedAt = null, errors = [], requests = [], dropped = { errors: 0, requests: 0 };
  const add = (kind, entry) => {
    if (!active || (kind === 'network' && options.recordNetwork === false)) return;
    const list = kind === 'errors' ? errors : kind === 'requests' ? requests : extra[kind];
    if (!list) return;
    if (list.length === LIMIT) { list.shift(); dropped[kind] = (dropped[kind] || 0) + 1; }
    const filtered = { ...entry };
    for (const key of ['message', 'error', 'stack', 'source', 'label', 'title', 'url']) if (typeof filtered[key] === 'string') filtered[key] = extraRedactor(filtered[key]);
    const record = { id: `${streamToken}:${runId}:${++sequence}`, time: now(), ...filtered, pageUrl: safeURL(location.href), pageDocumentId: `${performance.timeOrigin}` };
    list.push(record);
    if (kind === 'actions') nearbyAction = { id: record.id, time: Date.now() };
    if (options.eventName && options.sessionId) protect(() => window.dispatchEvent(new CustomEvent(options.eventName, { detail: JSON.stringify({ sessionId: options.sessionId, category: kind, entry: record }) }))); 
  };
  const protect = fn => { try { fn(); } catch { /* Diagnostics must never change page behavior. */ } };
  const errorListener = event => protect(() => {
    if (event.target && event.target !== window && event.target instanceof Element) {
      const url = event.target.currentSrc || event.target.src || event.target.href;
      if (url) add('requests', { kind: 'resource', method: 'GET', url: safeURL(url), status: null, error: `${event.target.localName} 资源加载失败` });
    } else add('errors', { kind: 'javascript', message: text(event.message || 'Script error.'), source: safeURL(event.filename || location.href), line: event.lineno || 0, column: event.colno || 0, stack: text(event.error?.stack || '') });
  });
  const rejectionListener = event => protect(() => add('errors', { kind: 'unhandledrejection', message: text(event.reason), stack: text(event.reason instanceof Error ? event.reason.stack : '') }));
  window.addEventListener('error', errorListener, true);
  window.addEventListener('unhandledrejection', rejectionListener);
  const originalConsole = console.error;
  const wrappedConsole = function (...args) {
    protect(() => add('errors', { kind: 'console.error', message: args.slice(0, 6).map(text).join(' ').slice(0, MAX) }));
    return Reflect.apply(originalConsole, this, args);
  };
  protect(() => { console.error = wrappedConsole; });
  const originalFetch = window.fetch;
  const wrappedFetch = function (...args) {
    // Call the original first; synchronous throws and response/rejection identities are preserved.
    const begun = performance.now ? performance.now() : Date.now(), requestId = `${runId}:fetch:${++requestSequence}`, nearbyActionId = nearbyAction && Date.now() - nearbyAction.time < 5000 ? nearbyAction.id : '';
    const promise = Reflect.apply(originalFetch, this, args);
    let url = '[无法解析的地址]', method = 'GET';
    protect(() => { url = safeURL(args[0] instanceof Request ? args[0].url : args[0]); method = String(args[1]?.method || (args[0] instanceof Request ? args[0].method : 'GET')).slice(0, 20); });
    protect(() => add('network', { kind: 'fetch-start', url, method, requestId, nearbyActionId, status: null, message: '发起请求' }));
    return promise.then(response => {
      protect(() => add('network', { kind: 'fetch', url, method, status: response.status, requestId, nearbyActionId, duration: (performance.now ? performance.now() : Date.now()) - begun, message: `请求完成：HTTP ${response.status}` }));
      protect(() => { if (response.status >= 400) add('requests', { kind: 'fetch', url, method, status: response.status, requestId, nearbyActionId, error: `HTTP ${response.status}` }); });
      return response;
    }, error => { protect(() => add('network', { kind: 'fetch', url, method, status: null, requestId, nearbyActionId, duration: (performance.now ? performance.now() : Date.now()) - begun, message: '请求未能完成' })); protect(() => add('requests', { kind: 'fetch', url, method, status: null, requestId, nearbyActionId, error: text(error) })); throw error; });
  };
  if (originalFetch) protect(() => { window.fetch = wrappedFetch; });
  const proto = XMLHttpRequest.prototype, originalOpen = proto.open, originalSend = proto.send, xhrs = new WeakMap();
  const wrappedOpen = function (...args) {
    const result = Reflect.apply(originalOpen, this, args);
    protect(() => xhrs.set(this, { method: String(args[0]).slice(0, 20), url: safeURL(args[1]) }));
    return result;
  };
  const wrappedSend = function (...args) {
    const details = xhrs.get(this), begun = performance.now ? performance.now() : Date.now(), requestId = `${runId}:xhr:${++requestSequence}`, nearbyActionId = nearbyAction && Date.now() - nearbyAction.time < 5000 ? nearbyAction.id : '';
    const onEnd = () => protect(() => {
      if (details) add('network', { kind: 'xhr', ...details, requestId, nearbyActionId, status: this.status || null, duration: (performance.now ? performance.now() : Date.now()) - begun, message: this.status ? `请求完成：HTTP ${this.status}` : '请求未能完成' });
      if (details && (this.status >= 400 || this.status === 0)) add('requests', { kind: 'xhr', ...details, requestId, nearbyActionId, status: this.status || null, error: this.status ? `HTTP ${this.status}` : '请求失败、被取消或跨域不可读' });
    });
    protect(() => { if (details) add('network', { kind: 'xhr-start', ...details, requestId, nearbyActionId, status: null, message: '发起请求' }); });
    this.addEventListener('loadend', onEnd, { once: true, capture: true });
    try { return Reflect.apply(originalSend, this, args); }
    catch (error) { this.removeEventListener('loadend', onEnd, true); throw error; }
  };
  protect(() => { proto.open = wrappedOpen; proto.send = wrappedSend; });
  const api = {
    record: (category, entry) => protect(() => add(category, entry)),
    onStop: fn => stopListeners.push(fn),
    setRedactor: fn => { extraRedactor = fn; },
    snapshot: () => ({ version: 1, sessionId: options.sessionId || null, eventName: options.eventName || null, active, startedAt, stoppedAt, pageUrl: safeURL(location.href),
      documentId: `${performance.timeOrigin}`, errors: errors.map(e => ({ ...e })), requests: requests.map(e => ({ ...e })), actions: extra.actions.map(e => ({ ...e })), feedback: extra.feedback.map(e => ({ ...e })), network: extra.network.map(e => ({ ...e })), navigation: extra.navigation.map(e => ({ ...e })), dropped: { ...dropped },
      coverage: options.sessionId ? '当前主文档事件实时发送到持续测试会话，直到手动停止；新文档由会话桥接重新接入。未采集请求头、请求体或响应体。' : '单页采集器：JS 错误、未处理 Promise、console.error、fetch/XHR 失败和资源 error 事件。未采集请求头、请求体或响应体。' }),
    clear: () => { errors = []; requests = []; dropped = { errors: 0, requests: 0 }; startedAt = now(); if (!active) stoppedAt = startedAt; },
    stop: () => {
      if (!active) return;
      for (const fn of stopListeners) protect(fn);
      active = false; stoppedAt = now();
      if (options.eventName) window.removeEventListener(`${options.eventName}-control`, control);
      window.removeEventListener('error', errorListener, true); window.removeEventListener('unhandledrejection', rejectionListener);
      protect(() => { if (console.error === wrappedConsole) console.error = originalConsole; });
      protect(() => { if (window.fetch === wrappedFetch) window.fetch = originalFetch; });
      protect(() => { if (proto.open === wrappedOpen) proto.open = originalOpen; });
      protect(() => { if (proto.send === wrappedSend) proto.send = originalSend; });
    }
  };
  const control = event => { if (event.detail === 'stop') api.stop(); };
  if (options.eventName) window.addEventListener(`${options.eventName}-control`, control);
  window[key] = api;
  return api.snapshot();
}

// MAIN-world values are page-controlled. Rebuild a bounded, typed object before saving.
export function sanitizeDiagnostics(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (s, max = 2000) => typeof s === 'string' ? s.slice(0, max) : '';
  const count = n => Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const list = (items, type) => (Array.isArray(items) ? items : []).slice(-100).map(item => {
    const e = item && typeof item === 'object' ? item : {};
    return type === 'errors' ? { time: str(e.time, 40), kind: str(e.kind, 40), message: str(e.message), source: str(e.source), line: count(e.line), column: count(e.column), stack: str(e.stack) } :
      { time: str(e.time, 40), kind: str(e.kind, 40), method: str(e.method, 20), url: str(e.url), status: Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : null, error: str(e.error) };
  });
  return { version: 1, active: raw.active === true, startedAt: str(raw.startedAt, 40), stoppedAt: str(raw.stoppedAt, 40) || null, pageUrl: str(raw.pageUrl), documentId: str(raw.documentId, 100), coverage: str(raw.coverage), errors: list(raw.errors, 'errors'), requests: list(raw.requests, 'requests'), dropped: { errors: count(raw.dropped?.errors), requests: count(raw.dropped?.requests) } };
}
