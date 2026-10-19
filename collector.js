// Injected only after an explicit capture request, in Chrome's isolated world.
(() => {
  if (globalThis.__bugsnap) return;
  let cleanup = () => {};
  function selector(el) {
    const parts = [];
    for (let node = el; node?.nodeType === 1; node = node.parentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`); break;
      }
      let part = node.localName;
      const classes = [...node.classList].slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
      if (classes) part += classes;
      if (node.parentElement) {
        const peers = [...node.parentElement.children].filter(s => s.localName === node.localName);
        if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
    }
    return parts.join(' > ');
  }
  function metadata(el) {
    const rect = el?.getBoundingClientRect();
    const attributes = {};
    // Never read live form values; retain structural attributes only.
    if (el) for (const attr of el.attributes) {
      if (/^(id|class|name|type|role|title|alt|placeholder|aria-label|aria-labelledby|data-testid|disabled|required)$/.test(attr.name)) attributes[attr.name] = attr.value.slice(0, 500);
    }
    return {
      page: { title: document.title, url: location.href, capturedAt: new Date().toISOString(),
        browser: navigator.userAgent, platform: navigator.platform,
        screen: { width: screen.width, height: screen.height },
        viewport: { width: innerWidth, height: innerHeight },
        window: { width: outerWidth, height: outerHeight },
        devicePixelRatio, documentId: `${performance.timeOrigin}`, scroll: { x: scrollX, y: scrollY } },
      element: el ? { selector: selector(el), tag: el.localName,
        text: /^(input|textarea|select)$/.test(el.localName) || el.isContentEditable ? '' : (el.innerText || el.textContent || '').trim().slice(0, 1000),
        attributes, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null
    };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'STOP_PICK') { cleanup(); respond({ ok: true }); return; }
    if (message.type === 'READ_PAGE') { cleanup(); respond(metadata(null)); return; }
    if (message.type !== 'START_PICK') return;
    cleanup();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #7560e8;background:#7560e81a;box-sizing:border-box;display:none';
    const hint = document.createElement('div');
    hint.textContent = 'BugSnap · 点击选择问题元素 · Esc 取消';
    hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:12px 18px;border-radius:10px;background:#29233f;color:white;font:13px system-ui;box-shadow:0 5px 30px #0003';
    shadow.append(box, hint); document.documentElement.append(host);
    let picked = false;
    const move = e => {
      if (!(e.target instanceof Element)) return;
      const r = e.target.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const cancel = () => {
      cleanup(); chrome.runtime.sendMessage({ type: 'PICK_CANCELLED', requestId: message.requestId }).catch(() => {});
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    const block = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    const click = async e => {
      block(e); if (picked || !(e.target instanceof Element)) return;
      picked = true;
      // Shadow DOM internals and iframe documents are intentionally not traversed in v1.
      const data = metadata(e.target); cleanup();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      chrome.runtime.sendMessage({ type: 'PICK_RESULT', requestId: message.requestId, data }).catch(() => {});
    };
    const expire = setTimeout(cancel, 120000);
    cleanup = () => {
      clearTimeout(expire); host.remove();
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('mousedown', block, true);
      document.removeEventListener('keydown', key, true);
      cleanup = () => {};
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    respond({ ok: true });
  });
  globalThis.__bugsnap = { selector, metadata };
})();
