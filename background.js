import { createSessionManager } from './session-manager.js';
import { UI_VERSION, RUNTIME_PROTOCOL } from './runtime-compat.js';
const sessions = createSessionManager(chrome);
sessions.install();
// Invoke the panel from the toolbar gesture so Chrome grants current-page access.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
async function handle(message, sender) {
  if (message.type === 'SESSION_HELLO') return sessions.hello(message, sender);
  if (message.type === 'SESSION_EVENT') return sessions.append(message, sender);
  if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('不受支持的请求来源。');
  if (message.type === 'RUNTIME_INFO') return { ok: true, runtime: { version: UI_VERSION, protocol: RUNTIME_PROTOCOL } };
  if (message.type === 'DIAGNOSTICS') return { ok: true, ...(await sessions.command(message)) };
  throw new Error('不支持的操作，请重新打开插件。');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(result => respond(result || { ok: true }), error => respond({ ok: false, error: error.message }));
  return true;
});
