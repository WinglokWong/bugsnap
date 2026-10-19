import { createSessionManager } from './session-manager.js';
const sessions = createSessionManager(chrome);
sessions.install();
// Route the toolbar click through the extension action so Chrome grants activeTab.
// Chrome's built-in side-panel toggle can open the UI without granting page access.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
chrome.action.onClicked.addListener(tab => {
  // Keep open() in the original user gesture, before any await or storage work.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
const key = windowId => `capture:${windowId}`;
function requirePage(tab) {
  if (!tab.url) throw new Error('尚未获得当前网页的临时访问权限。请点击 Chrome 顶部工具栏的 BugSnap 图标，再重试。');
  if (!/^(https?:|file:)/.test(tab.url)) throw new Error('当前是浏览器内置或其他受限制页面。请先打开普通网站，再点击工具栏的 BugSnap 图标。');
  if (/^https:\/\/(chromewebstore.google.com|chrome.google.com\/webstore)/.test(tab.url)) throw new Error('Chrome 扩展商店禁止注入，请在其他网页使用。');
}
async function current(windowId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab) throw new Error('没有可采集的活动标签页。');
  return tab;
}
async function finish(tab, requestId, data) {
  const before = await current(tab.windowId);
  if (before.id !== tab.id || before.url !== data.page.url || before.status === 'loading') throw new Error('页面已切换或正在加载，请重新采集。');
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 90 });
  const diagnostics = await sessions.forCapture(tab.id, data.page.documentId);
  const after = await current(tab.windowId);
  if (after.id !== tab.id || after.url !== data.page.url || after.status === 'loading') throw new Error('截图期间页面已变化，请重新采集。');
  return { requestId, tabId: tab.id, ...data, screenshot, diagnostics };
}
async function handle(message, sender) {
  if (message.type === 'SESSION_HELLO') return sessions.hello(message, sender);
  if (message.type === 'SESSION_EVENT') return sessions.append(message, sender);
  if (message.type === 'PICK_RESULT' || message.type === 'PICK_CANCELLED') {
    if (!sender.tab || sender.frameId !== 0) return;
    const requestKey = `pick:${sender.tab.windowId}`;
    const saved = (await chrome.storage.session.get(requestKey))[requestKey];
    if (!saved || saved.id !== message.requestId || saved.tabId !== sender.tab.id) return;
    try {
      const result = message.type === 'PICK_CANCELLED' ? { requestId: saved.id, cancelled: true } : await finish(sender.tab, saved.id, message.data);
      await chrome.storage.session.set({ [key(sender.tab.windowId)]: result });
    } catch (error) {
      await chrome.storage.session.set({ [key(sender.tab.windowId)]: { requestId: saved.id, error: error.message } });
    } finally { await chrome.storage.session.remove(requestKey); }
    return { ok: true };
  }
  // Page content scripts may only submit selection results, never command captures.
  if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('不受支持的请求来源。');
  if (message.type === 'DIAGNOSTICS') return { ok: true, ...(await sessions.command(message)) };
  if (message.type === 'CANCEL') {
    const requestKey = `pick:${message.windowId}`;
    const saved = (await chrome.storage.session.get(requestKey))[requestKey];
    if (saved) await chrome.tabs.sendMessage(saved.tabId, { type: 'STOP_PICK' }).catch(() => {});
    await chrome.storage.session.remove(requestKey); return { ok: true };
  }
  if (!['PICK', 'CAPTURE'].includes(message.type)) return;
  const tab = await current(message.windowId);
  requirePage(tab);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
  if (message.type === 'PICK') {
    await chrome.storage.session.set({ [`pick:${tab.windowId}`]: { id: message.requestId, tabId: tab.id } });
    await chrome.tabs.sendMessage(tab.id, { type: 'START_PICK', requestId: message.requestId });
    return { ok: true };
  }
  const data = await chrome.tabs.sendMessage(tab.id, { type: 'READ_PAGE' });
  return { ok: true, result: await finish(tab, message.requestId, data) };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(result => respond(result || { ok: true }), error => respond({ ok: false, error: error.message }));
  return true;
});

async function invalidatePick(windowId, tabId, reason) {
  const requestKey = `pick:${windowId}`;
  const saved = (await chrome.storage.session.get(requestKey))[requestKey];
  if (!saved || (tabId != null && saved.tabId !== tabId)) return;
  await chrome.tabs.sendMessage(saved.tabId, { type: 'STOP_PICK' }).catch(() => {});
  await chrome.storage.session.remove(requestKey);
  await chrome.storage.session.set({ [key(windowId)]: { requestId: saved.id, error: reason } });
}
chrome.tabs.onActivated.addListener(({ windowId }) => {
  invalidatePick(windowId, null, '已切换标签页，元素选择已取消。请在新页面点击工具栏图标授权后重新采集。').catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading') invalidatePick(tab.windowId, tabId, '页面正在跳转，元素选择已取消。').catch(console.error);
});
chrome.tabs.onRemoved.addListener((tabId, info) => {
  invalidatePick(info.windowId, tabId, '目标标签页已关闭。').catch(console.error);
});
chrome.windows.onRemoved.addListener(windowId => {
  chrome.storage.session.remove([key(windowId), `pick:${windowId}`]).catch(console.error);
});
