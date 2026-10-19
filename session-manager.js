import { sessionDB } from './session-db.js';
import { newSession, safePageURL, sessionSnapshot } from './session-model.js';
import { pageDiagnostics } from './diagnostics.js';
import { installInteractionRecorder } from './interaction-recorder.js';
import { emptyCounts, eventCategories, sanitizeRecordedEvent, redactText } from './event-schema.js';
const SCRIPT = 'bugsnap-session-bridge';
export function createSessionManager(chrome, db = sessionDB, uuid = () => crypto.randomUUID()) {
  // One queue protects read-modify-write state from concurrent page events and worker restarts.
  let queue = Promise.resolve(), browserIdPromise, ending, lastCaptureAt = 0;
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const browserId = () => browserIdPromise ||= chrome.storage.session.get('sessionBrowserId').then(async data => {
    if (data.sessionBrowserId) return data.sessionBrowserId;
    const id = uuid(); await chrome.storage.session.set({ sessionBrowserId: id }); return id;
  });
  async function currentSession() {
    const { diagnosticSessionId } = await chrome.storage.local.get('diagnosticSessionId');
    if (!diagnosticSessionId) return null;
    const s = await db.get(diagnosticSessionId);
    if (s?.active && s.browserId !== await browserId()) {
      s.browserId = await browserId(); s.tabIds = []; s.bindings = {}; s.status = 'waiting'; s.needsResume = true;
      s.lastError = '浏览器或插件重新启动。旧日志已保留，点击「继续记录这个网页」继续；浏览器关闭期间无法记录。'; await db.put(s);
    }
    const { diagnosticSessionFault } = await chrome.storage.local.get('diagnosticSessionFault');
    if (s && diagnosticSessionFault?.id === s.id) {
      s.losses = diagnosticSessionFault.losses; s.lastError = diagnosticSessionFault.message;
      if (s.active) s.status = 'storage-error';
    }
    if (s) s.counts = { ...emptyCounts(), ...s.counts };
    return s;
  }
  async function publish(s) {
    s.revision++;
    await db.put(s);
    await chrome.storage.local.set({ diagnosticSessionId: s.id, diagnosticSessionStatus: { id: s.id, active: s.active, status: s.status, counts: s.counts, error: s.lastError, revision: s.revision } });
    chrome.action.setBadgeText({ text: s.active ? (['permission', 'storage-error'].includes(s.status) ? '!' : 'REC') : '' }).catch(() => {});
    if (s.active) chrome.action.setBadgeBackgroundColor({ color: '#d45172' }).catch(() => {});
  }
  async function publishHistoryChange() {
    const { diagnosticHistoryRevision = 0 } = await chrome.storage.local.get('diagnosticHistoryRevision');
    await chrome.storage.local.set({ diagnosticHistoryRevision: diagnosticHistoryRevision + 1 });
  }
  async function ensureBridge() {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT] });
    if (!scripts.length) await chrome.scripting.registerContentScripts([{ id: SCRIPT, matches: ['http://*/*', 'https://*/*'], js: ['diagnostic-bridge.js'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]);
  }
  async function poke(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['diagnostic-bridge.js'] });
    // Do not await a bridge handshake: it returns through the same serialized queue.
    chrome.tabs.sendMessage(tabId, { type: 'SESSION_SYNC' }).catch(() => {});
  }
  async function allowed() { return chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }); }
  async function snapshot(s, full) {
    if (!s) return { diagnostics: null, sessionId: null };
    s.counts = { ...emptyCounts(), ...s.counts };
    const limits = Object.fromEntries(eventCategories.map(k => [k, Math.min(s.counts[k], k === 'network' ? 30 : 100)]));
    return { sessionId: s.id, tabId: s.primaryTabId, pageUrl: s.startUrl, diagnostics: sessionSnapshot(s, await db.events(s.id, full ? null : limits), full) };
  }
  function validSender(sender) { return sender.tab && sender.frameId === 0 && sender.documentId && safePageURL(sender.url); }
  async function hello(message, sender) {
    const s = await currentSession();
    if (!s?.active || s.needsResume || s.status === 'stopping' || !validSender(sender)) return { active: false };
    if (!s.tabIds.includes(sender.tab.id)) {
      if (s.followActive && sender.tab.active && sender.tab.windowId === s.ownerWindowId) s.tabIds.push(sender.tab.id);
      else return { active: false };
    }
    if (!(await allowed())) { s.status = 'permission'; s.lastError = '网站访问授权已被撤销。已有记录已保留，重新授权后可继续。'; await publish(s); return { active: false }; }
    const page = { tabId: sender.tab.id, documentId: sender.documentId, pageDocumentId: String(message.pageDocumentId).slice(0, 100), url: safePageURL(sender.url), title: String(message.title || '').slice(0, 200), time: new Date().toISOString() };
    const token = String(message.token || '').slice(0, 100); if (!token) return { active: false };
    s.bindings[sender.documentId] = { ...page, token };
    const visited = s.pages.some(p => p.documentId === page.documentId);
    if (!visited) s.pages.push(page);
    s.currentDocuments ||= {};
    if (s.currentDocuments[page.tabId] !== page.documentId) {
      await db.append(s, { id: `navigation:${sender.documentId}:${s.revision}`, category: 'navigation', order: s.revision, pageUrl: page.url, tabId: page.tabId, pageDocumentId: page.pageDocumentId, receivedAt: page.time, entry: { time: page.time, kind: 'navigation', message: visited ? '返回或重新打开了网页' : '打开了网页' } });
      s.currentDocuments[page.tabId] = page.documentId;
    }
    if (!s.environment && message.environment) {
      const env = message.environment; s.environment = { browser: String(env.browser || '').slice(0, 250), platform: String(env.platform || '').slice(0, 80), viewport: { width: Number(env.width) || 0, height: Number(env.height) || 0 }, devicePixelRatio: Number(env.dpr) || 1 };
    }
    s.status = 'recording'; s.lastError = ''; await publish(s);
    try {
      await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, documentIds: [sender.documentId] }, world: 'MAIN', func: pageDiagnostics, args: ['start', { sessionId: s.id, eventName: `bugsnap-stream-${token}`, recordNetwork: s.recordingVersion >= 2 }] });
      if (s.recordingVersion >= 2) await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, documentIds: [sender.documentId] }, world: 'MAIN', func: installInteractionRecorder, args: [{}] });
    } catch (error) { s.status = 'waiting'; s.lastError = `页面接入中断：${error.message}`; await publish(s); return { active: false }; }
    return { active: true, sessionId: s.id };
  }
  async function append(message, sender) {
    const s = await currentSession(), binding = s?.bindings[sender.documentId];
    if (!s?.active || !validSender(sender) || !s.tabIds.includes(sender.tab.id) || s.id !== message.sessionId || !binding || binding.tabId !== sender.tab.id || binding.token !== message.token) return { accepted: false };
    if (!(await allowed())) return { accepted: false };
    if (!['errors', 'requests', 'actions', 'feedback', 'network', 'navigation'].includes(message.category)) return { accepted: false };
    const raw = message.entry;
    if (!raw || typeof raw.id !== 'string' || !raw.id.startsWith(`${message.token}:`) || raw.id.length > 150) return { accepted: false };
    const sanitized = sanitizeRecordedEvent(raw, message.category);
    const claimedURL = safePageURL(raw.pageUrl);
    const pageUrl = claimedURL && new URL(claimedURL).origin === new URL(binding.url).origin ? claimedURL : binding.url;
    try {
      const added = await db.append(s, { id: raw.id, category: message.category, order: s.revision, entry: sanitized, pageUrl, tabId: sender.tab.id, pageDocumentId: binding.pageDocumentId, receivedAt: new Date().toISOString() });
      if (added) await publish(s);
      return { accepted: true };
    } catch (error) {
      s.status = 'storage-error'; s.lastError = `日志保存失败，后续记录可能不完整：${error.message}`;
      const losses = { ...emptyCounts(), ...s.losses }; losses[message.category]++;
      await chrome.storage.local.set({ diagnosticSessionFault: { id: s.id, message: s.lastError, losses }, diagnosticSessionStatus: { id: s.id, active: true, status: s.status, error: s.lastError, revision: Date.now() } });
      return { accepted: false, error: s.lastError };
    }
  }
  async function writeTrusted(s, category, tab, entry) {
    const time = new Date().toISOString();
    await db.append(s, { id: `${category}:${uuid()}`, category, order: s.revision, pageUrl: safePageURL(tab?.url), tabId: tab?.id || null, pageDocumentId: '', receivedAt: time, entry: { time, ...entry } });
    s.revision++;
  }
  async function captureEvidence(s, windowId, caption) {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    const fail = async reason => { await writeTrusted(s, 'evidence', tab, { kind: 'screenshot-missing', message: `${caption}：未保存画面`, reason }); return { saved: false, reason }; };
    if (!tab || !s.tabIds.includes(tab.id) || !safePageURL(tab.url)) return fail('当前显示的网页不在本次记录中');
    if ((s.counts.evidence || 0) >= 12) return fail('本次记录已达到自动画面保存上限；文字记录仍会继续');
    try {
      const wait = 600 - (Date.now() - lastCaptureAt); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      const [before] = await chrome.tabs.query({ active: true, windowId });
      if (before?.id !== tab.id || before.url !== tab.url) return fail('等待保存画面时网页已切换');
      lastCaptureAt = Date.now();
      let image = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
      const [after] = await chrome.tabs.query({ active: true, windowId });
      if (after?.id !== tab.id || after.url !== tab.url) return fail('保存画面时网页已切换');
      if (typeof OffscreenCanvas !== 'undefined') {
        const bitmap = await createImageBitmap(await (await fetch(image)).blob());
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .72 })).arrayBuffer());
        let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        image = `data:image/jpeg;base64,${btoa(binary)}`;
      }
      if (image.length > 2000000) return fail('当前画面太大，文字记录已保留');
      await writeTrusted(s, 'evidence', tab, { kind: 'screenshot', message: caption, image });
      return { saved: true };
    } catch (error) { return fail(/activeTab|all_urls|permission/i.test(error.message) ? '未获得截图权限；操作和问题标记仍已保存' : '浏览器暂时无法保存画面；文字记录仍会继续'); }
  }
  async function stopWithDrain(message) {
    const prepared = await serial(async () => {
      const s = await currentSession(); if (!s) throw new Error('还没有开始记录。');
      if (message.sessionId && message.sessionId !== s.id) throw new Error('当前记录已变化，请重试。');
      if (s.active) { s.status = 'stopping'; await publish(s); }
      return s;
    });
    if (prepared.active) {
      await Promise.allSettled(prepared.tabIds.map(tabId => new Promise(resolve => {
        const timer = setTimeout(resolve, 2000);
        chrome.tabs.sendMessage(tabId, { type: 'SESSION_STOP' }).catch(() => {}).finally(() => { clearTimeout(timer); resolve(); });
      })));
    }
    return serial(() => command(message));
  }
  async function command(message) {
    let s = await currentSession();
    if (message.action === 'list') return { sessions: (await db.list()).map(x => ({ id: x.id, active: x.active, startedAt: x.startedAt, stoppedAt: x.stoppedAt, startUrl: x.startUrl, counts: x.counts })).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
    if (message.action === 'read') return snapshot(message.sessionId ? await db.get(message.sessionId) : s, Boolean(message.full));
    if (message.action === 'delete') {
      if (typeof message.sessionId !== 'string' || !message.sessionId.trim()) throw new Error('请选择要删除的记录。');
      const record = await db.get(message.sessionId);
      if (!record) throw new Error('这条记录已不存在，请刷新列表。');
      if (record.active) throw new Error('这条记录还在进行中，请先结束记录，再删除。');
      await db.delete(record.id);
      if (s?.id === record.id) {
        await chrome.storage.local.set({ diagnosticSessionId: null, diagnosticSessionStatus: null, diagnosticSessionFault: null });
        chrome.action.setBadgeText({ text: '' }).catch(() => {});
      }
      await publishHistoryChange();
      return { deleted: true, sessionId: record.id };
    }
    if (message.action === 'start' || message.action === 'join') {
      if (s?.status === 'stopping') throw new Error('正在结束上一次记录，请稍候。');
      if (!(await allowed())) throw new Error('连续记录需要网站访问授权。请点击「开始记录」并在 Chrome 提示中确认。');
      const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
      if (!tab || !safePageURL(tab.url) || tab.url.startsWith('https://chromewebstore.google.com/')) throw new Error('请先打开你要反馈的网站，再点击开始记录。');
      const created = !s?.active;
      if (created) {
        if (message.action === 'join') throw new Error('当前没有进行中的记录，请先开始记录。');
        s = newSession(tab, await browserId(), uuid());
      } else if (!s.tabIds.includes(tab.id)) s.tabIds.push(tab.id);
      s.needsResume = false;
      if (message.followActive === true) { s.followActive = true; s.ownerWindowId = message.windowId; }
      if (typeof message.screenshots === 'boolean') s.screenshots = message.screenshots;
      await ensureBridge(); await publish(s);
      if (created) await publishHistoryChange();
      try { await poke(tab.id); } catch (error) { s.status = 'waiting'; s.lastError = `此页暂未接入：${error.message}`; await publish(s); }
      return snapshot(s, false);
    }
    if (!s) throw new Error('还没有开始记录。');
    if (message.action === 'clear' && message.sessionId && message.sessionId !== s.id) {
      const archived = await db.get(message.sessionId);
      if (!archived || archived.active) throw new Error('无法清空这份历史会话。');
      archived.counts = emptyCounts(); archived.losses = emptyCounts(); archived.lastError = ''; archived.clearedAt = new Date().toISOString();
      await db.clear(archived); return snapshot(archived, false);
    }
    if (message.sessionId && message.sessionId !== s.id) throw new Error('当前记录已变化，请重新打开插件再操作。');
    if (message.action === 'stop') {
      if (!s.active) return snapshot(s, false);
      if (s.active && s.screenshots) await captureEvidence(s, message.windowId, '结束记录');
      if (typeof message.note === 'string') s.note = redactText(message.note, 3000);
      s.active = false; s.stoppedAt = new Date().toISOString(); s.status = 'stopped'; s.lastError = ''; await publish(s);
      await publishHistoryChange();
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT] }).catch(() => {});
      return snapshot(s, false);
    }
    if (message.action === 'note') { s.note = redactText(message.note, 3000); await publish(s); return { saved: true }; }
    if (message.action === 'mark' || message.action === 'evidence') {
      if (!s.active || s.status === 'stopping') throw new Error('请先开始记录。');
      const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
      if (!tab || !safePageURL(tab.url) || !s.tabIds.includes(tab.id)) throw new Error('当前网页没有在本次记录中，请先点击「继续记录这个网页」。');
      if (message.action === 'mark') await writeTrusted(s, 'markers', tab, { kind: 'problem', message: '用户在这里遇到了问题', note: redactText(message.note, 1000) });
      const evidence = s.screenshots ? await captureEvidence(s, message.windowId, message.action === 'mark' ? '问题发生时的画面' : '开始记录') : { saved: false, reason: '未开启画面保存' };
      await publish(s); return { ...(await snapshot(s, false)), evidence };
    }
    if (message.action === 'clear') {
      s.counts = emptyCounts(); s.clearedAt = new Date().toISOString();
      s.losses = emptyCounts(); s.lastError = ''; s.status = s.active ? 'recording' : 'stopped';
      await chrome.storage.local.set({ diagnosticSessionFault: null });
      await db.clear(s); await publish(s); return snapshot(s, false);
    }
    throw new Error('无效的会话操作。');
  }
  return {
    command: message => {
      if (message.action !== 'stop') return serial(() => command(message));
      if (!ending) ending = stopWithDrain(message).finally(() => { ending = null; });
      return ending;
    },
    hello: (message, sender) => serial(() => hello(message, sender)),
    append: (message, sender) => serial(() => append(message, sender)),
    install() {
      chrome.tabs.onActivated?.addListener(info => serial(async () => {
        const s = await currentSession(); if (!s?.active || s.needsResume || s.status === 'stopping' || !s.followActive || s.ownerWindowId !== info.windowId) return;
        const tab = await chrome.tabs.get(info.tabId); if (!safePageURL(tab.url)) return;
        if (!s.tabIds.includes(tab.id)) s.tabIds.push(tab.id);
        await writeTrusted(s, 'navigation', tab, { kind: 'tab-switch', message: '切换到这个网页' }); await publish(s);
        await poke(tab.id).catch(() => {});
      }).catch(console.error));
      chrome.permissions.onRemoved?.addListener(() => serial(async () => {
        const s = await currentSession(); if (!s?.active || await allowed()) return;
        s.status = 'permission'; s.lastError = '网站权限已撤销，记录已暂停。已有内容仍保留，重新授权后可继续。'; await publish(s);
        await Promise.allSettled(s.tabIds.map(tabId => chrome.tabs.sendMessage(tabId, { type: 'SESSION_STOP' })));
      }).catch(console.error));
      chrome.tabs.onCreated.addListener(tab => { if (tab.openerTabId != null) serial(async () => {
        const s = await currentSession(); if (!s?.active || s.needsResume || s.status === 'stopping' || !s.tabIds.includes(tab.openerTabId) || s.tabIds.includes(tab.id)) return;
        s.tabIds.push(tab.id); await publish(s);
        if (safePageURL(tab.url)) await poke(tab.id).catch(() => {});
      }).catch(console.error); });
      chrome.tabs.onUpdated.addListener((tabId, change, tab) => { if (change.status === 'loading' || change.status === 'complete') serial(async () => {
        const s = await currentSession(); if (!s?.active || s.needsResume || s.status === 'stopping') return;
        if (!s.tabIds.includes(tabId)) {
          if (s.followActive && tab.active && tab.windowId === s.ownerWindowId && safePageURL(tab.url)) s.tabIds.push(tabId);
          else return;
        }
        s.status = change.status === 'loading' ? 'connecting' : 'recording';
        if (!safePageURL(tab.url) || tab.url?.startsWith('https://chromewebstore.google.com/')) { s.status = 'waiting'; s.lastError = '这个页面暂时无法记录。已有内容已保留，返回已授权的网站后继续。'; }
        await publish(s);
        if (change.status === 'complete' && safePageURL(tab.url)) {
          try { await poke(tabId); }
          catch (error) { s.status = 'waiting'; s.lastError = `此页面未能接入记录：${error.message}。旧日志仍保留。`; await publish(s); }
        }
      }).catch(console.error); });
      chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
        const s = await currentSession(); if (!s?.active || s.status === 'stopping' || !s.tabIds.includes(tabId)) return;
        s.tabIds = s.tabIds.filter(id => id !== tabId);
        if (!s.tabIds.length) { s.status = 'waiting'; s.lastError = '正在记录的网页都已关闭。打开要反馈的网站，点击「继续记录这个网页」。'; }
        await publish(s);
      }).catch(console.error));
    }
  };
}
