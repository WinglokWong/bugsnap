/** Executed inside the page's MAIN world. This function has no external dependencies. */
export function installInteractionRecorder(options = {}) {
  const api = window.__BUGSNAP_DIAGNOSTICS_V2__;
  if (!api?.record || !api.snapshot().active) return false;
  if (window.__bugsnapInteractions?.api === api) return true;
  window.__bugsnapInteractions?.stop();
  const cleanups = [], inputs = new Map(), feedbackSeen = new WeakMap();
  let scrollTimer, feedbackTimer, stopped = false;
  const candidateRoots = new Set(), privateValues = new Set();
  const protect = fn => { try { return fn(); } catch { return undefined; } };
  const redact = value => {
    let text = String(value || '');
    for (const secret of privateValues) text = text.split(secret).join('[填写内容已隐藏]');
    return text.slice(0, 1200)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已隐藏]')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]')
    .replace(/((?:password|token|secret|authorization|api[_-]?key|密码|验证码)\s*[:：=]\s*)[^\s,，;；]+/gi, '$1[已隐藏]');
  };
  const safeURL = value => { try { const u = new URL(value, location.href); u.username = ''; u.password = ''; u.search = ''; u.hash = u.hash.startsWith('#/') ? u.hash.split('?')[0] : ''; return u.href.slice(0, 1000); } catch { return ''; } };
  const sensitive = el => /password|hidden|file/i.test(el?.type || '') || /pass(word|code)?|secret|token|otp|one.?time|credit|card.?number|cvv|cvc|密码|验证码|身份证|银行卡/i.test(`${el?.name || ''} ${el?.id || ''} ${el?.autocomplete || ''}`) || el?.closest?.('[data-private],[data-sensitive],[data-bugsnap-ignore]');
  const publicText = el => {
    if (!el || sensitive(el) || el.isContentEditable || el.closest?.('[contenteditable]') || el.matches?.('input,textarea,select')) return '';
    const copy = el.cloneNode(true);
    copy.querySelectorAll?.('input,textarea,select,script,style,[contenteditable],[data-private],[data-sensitive],[data-bugsnap-ignore]').forEach(n => n.remove());
    return redact(copy.textContent?.replace(/\s+/g, ' ').trim()).slice(0, 180);
  };
  const label = el => {
    if (sensitive(el)) return '敏感字段';
    const explicit = el.getAttribute?.('aria-label') || (el.labels?.[0] ? publicText(el.labels[0]) : '') || el.getAttribute?.('placeholder');
    return redact(explicit || publicText(el) || ({ input: '输入框', textarea: '文本框', select: '下拉框', button: '按钮', a: '链接', form: '表单' }[el.localName]) || el.localName).slice(0, 100);
  };
  const selector = el => {
    if (sensitive(el)) return '';
    const parts = [];
    for (let node = el; node?.parentElement && parts.length < 6; node = node.parentElement) {
      const peers = [...node.parentElement.children].filter(n => n.localName === node.localName);
      parts.unshift(`${node.localName}:nth-of-type(${peers.indexOf(node) + 1})`);
    }
    return parts.join(' > ');
  };
  const describe = el => ({ tag: el.localName, label: label(el), selector: selector(el) });
  const emit = (category, entry) => { if (!stopped) api.record(category, entry); };
  const on = (target, event, listener, options = true) => { target.addEventListener(event, listener, options); cleanups.push(() => target.removeEventListener(event, listener, options)); };
  const isUser = event => event.isTrusted || options.recordSynthetic === true;
  const editable = node => node instanceof Element && (node.matches('input,textarea,select') || node.isContentEditable);
  const target = event => {
    const node = event.composedPath?.().find(n => n instanceof Element) || event.target;
    return node instanceof Element ? node.closest('button,a,input,textarea,select,label,[role=button],[role=checkbox],[role=radio],[contenteditable=true]') || node : null;
  };
  const rememberInput = el => {
    if (!editable(el) || ['checkbox', 'radio', 'hidden', 'file'].includes(el.type)) return;
    const value = el.isContentEditable ? el.textContent : el.value;
    if (typeof value === 'string' && value.length >= (sensitive(el) ? 1 : 3) && value.length <= 3000) {
      privateValues.add(value); if (privateValues.size > 100) privateValues.delete(privateValues.values().next().value);
    }
  };
  document.querySelectorAll('input,textarea,[contenteditable]').forEach(el => protect(() => rememberInput(el)));
  api.setRedactor?.(redact);
  const inputState = el => {
    rememberInput(el); const info = describe(el);
    if (sensitive(el)) return { ...info, state: '已编辑，内容不记录', kind: 'input', message: '编辑了敏感字段（内容未记录）' };
    if (el.matches('select')) return { ...info, state: `选项序号 ${el.selectedIndex + 1}`, kind: 'change', message: `更改了「${info.label}」的选择（选项内容未记录）` };
    if (['checkbox', 'radio'].includes(el.type)) return { ...info, state: el.checked ? '已选中' : '未选中', kind: 'change', message: `${el.checked ? '选中' : '取消选中'}「${info.label}」` };
    const nonempty = el.isContentEditable ? Boolean(el.textContent?.length) : Boolean(el.value?.length);
    return { ...info, state: nonempty ? '已填写' : '已清空', kind: 'input', message: `${nonempty ? '填写' : '清空'}了「${info.label}」（内容未记录）` };
  };
  const flushInputs = () => {
    for (const [el, timer] of inputs) { clearTimeout(timer); protect(() => emit('actions', inputState(el))); }
    inputs.clear();
  };
  on(document, 'click', event => protect(() => {
    if (!isUser(event)) return;
    const el = target(event); if (!el || el.closest('[data-bugsnap-ignore]')) return;
    flushInputs(); const info = describe(el);
    emit('actions', { kind: 'click', ...info, message: `点击了「${info.label}」`, x: Math.round(event.clientX || 0), y: Math.round(event.clientY || 0) });
  }));
  on(document, 'input', event => protect(() => {
    if (!isUser(event) || !editable(event.target)) return;
    const el = event.target; rememberInput(el); clearTimeout(inputs.get(el));
    inputs.set(el, setTimeout(() => { inputs.delete(el); protect(() => emit('actions', inputState(el))); }, 500));
  }));
  on(document, 'change', event => protect(() => {
    if (!isUser(event) || !editable(event.target)) return;
    clearTimeout(inputs.get(event.target)); inputs.delete(event.target); emit('actions', inputState(event.target));
  }));
  on(document, 'submit', event => protect(() => {
    if (!isUser(event) || !(event.target instanceof Element)) return;
    flushInputs(); emit('actions', { kind: 'submit', ...describe(event.target), message: '提交了表单', destination: safeURL(event.target.action || location.href) });
  }));
  on(document, 'keydown', event => protect(() => {
    if (!isUser(event) || !['Enter', 'Escape'].includes(event.key)) return;
    const el = target(event); if (!el || sensitive(el)) return;
    flushInputs(); emit('actions', { kind: 'key', ...describe(el), message: event.key === 'Enter' ? '按下了回车键' : '按下了 Esc 键' });
  }));
  on(document, 'invalid', event => protect(() => {
    const el = event.target; if (!(el instanceof Element)) return;
    emit('feedback', { kind: 'validation', ...describe(el), message: `「${label(el)}」未通过表单校验${el.validity?.valueMissing ? '：必填项未填写' : '：格式或内容不符合要求'}` });
  }));
  on(document, 'scroll', event => {
    if (!isUser(event)) return;
    clearTimeout(scrollTimer);
    const el = event.target;
    scrollTimer = setTimeout(() => protect(() => emit('actions', { kind: 'scroll', label: '页面滚动', message: '滚动了页面或内容区域', x: Math.round(el === document ? scrollX : el.scrollLeft || 0), y: Math.round(el === document ? scrollY : el.scrollTop || 0) })), 650);
  }, { capture: true, passive: true });
  on(window, 'pagehide', flushInputs);
  let lastURL = location.href;
  const route = () => {
    if (lastURL === location.href) return;
    const before = safeURL(lastURL), after = safeURL(location.href); lastURL = location.href;
    emit('navigation', { kind: 'route', message: before === after ? '页面地址参数发生变化（参数值未记录）' : '切换了页面内容', from: before, destination: after, title: redact(document.title).slice(0, 160) });
  };
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    const wrapper = function (...args) { const result = Reflect.apply(original, this, args); protect(route); return result; };
    history[method] = wrapper; cleanups.push(() => { if (history[method] === wrapper) history[method] = original; });
  }
  on(window, 'popstate', () => protect(route)); on(window, 'hashchange', () => protect(route));
  for (const method of ['alert', 'confirm', 'prompt']) {
    const original = window[method];
    if (typeof original !== 'function') continue;
    const wrapper = function (...args) {
      protect(() => emit('feedback', { kind: 'dialog', message: `显示${method === 'alert' ? '提示' : method === 'confirm' ? '确认' : '输入'}弹窗：${redact(args[0])}` }));
      const result = Reflect.apply(original, this, args);
      protect(() => emit('feedback', { kind: 'dialog-result', message: method === 'confirm' ? `用户${result ? '确认' : '取消'}了弹窗` : method === 'prompt' ? `用户${result === null ? '取消' : '提交'}了输入弹窗（内容未记录）` : '用户关闭了提示弹窗' }));
      return result;
    };
    window[method] = wrapper; cleanups.push(() => { if (window[method] === wrapper) window[method] = original; });
  }
  const feedbackSelector = '[role=alert],[role=status],[role=dialog],[aria-modal=true],dialog[open],.toast,.notification,.ant-message-notice,.ant-notification-notice,.el-message,.el-notification,[data-bugsnap-feedback]';
  const visible = el => { const rect = el.getBoundingClientRect(); const style = getComputedStyle(el); return !el.hidden && el.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0); };
  const inspectFeedback = el => protect(() => {
    if (!visible(el)) { feedbackSeen.delete(el); return; }
    const message = publicText(el); if (!message) return;
    const previous = feedbackSeen.get(el);
    if (previous?.message === message && Date.now() - previous.time < 1500) return;
    feedbackSeen.set(el, { message, time: Date.now() });
    emit('feedback', { kind: 'page-message', message: `页面显示：${message}`, tag: el.localName, selector: selector(el) });
  });
  const scan = () => {
    feedbackTimer = null;
    for (const root of candidateRoots) {
      if (root.matches?.(feedbackSelector)) inspectFeedback(root);
      const parent = root.closest?.(feedbackSelector); if (parent) inspectFeedback(parent);
      root.querySelectorAll?.(feedbackSelector).forEach((el, index) => { if (index < 30) inspectFeedback(el); });
    }
    candidateRoots.clear();
  };
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (!el) continue;
        if (record.type === 'attributes' && record.attributeName === 'aria-busy') protect(() => emit('feedback', { kind: 'loading', label: label(el), message: el.getAttribute('aria-busy') === 'true' ? '页面区域开始加载' : '页面区域结束加载' }));
        if (candidateRoots.size >= 80) continue;
        if (el.matches?.(feedbackSelector) || el.closest?.(feedbackSelector)) candidateRoots.add(el);
        if (record.type === 'childList') for (const node of record.addedNodes) {
          if (node.nodeType === 1 && (node.matches?.(feedbackSelector) || node.querySelector?.(feedbackSelector))) candidateRoots.add(node);
        }
      }
      if (candidateRoots.size && !feedbackTimer) feedbackTimer = setTimeout(scan, 50);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'aria-busy', 'class', 'style'] });
    cleanups.push(() => observer.disconnect());
    candidateRoots.add(document.documentElement); feedbackTimer = setTimeout(scan, 0);
  }
  const ready = () => emit('feedback', { kind: 'page-ready', message: '页面已加载', title: redact(document.title).slice(0, 160) });
  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', ready, { once: true }); else ready();
  const stop = () => {
    if (stopped) return;
    scan(); flushInputs(); stopped = true; clearTimeout(scrollTimer); clearTimeout(feedbackTimer);
    for (const cleanup of cleanups) protect(cleanup);
    privateValues.clear();
  };
  api.onStop(stop);
  window.__bugsnapInteractions = { api, stop };
  return true;
}
