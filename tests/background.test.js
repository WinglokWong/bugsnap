import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { UI_VERSION, RUNTIME_PROTOCOL } from '../runtime-compat.js';
const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
function setup() {
  let listener; const data = {}, events = {}, captureCalls = [];
  const tab = { id: 5, windowId: 1, url: 'https://example.com/', status: 'complete' };
  const page = { url: tab.url };
  const chrome = {
    sidePanel: { setPanelBehavior: async options => { events.panelBehavior = options; }, open: async options => { events.panelOpened = options; } },
    action: { onClicked: { addListener: fn => events.toolbarClick = fn } },
    runtime: { getURL: () => 'chrome-extension://test/', onMessage: { addListener: fn => listener = fn } },
    storage: { session: { get: async key => ({ [key]: data[key] }), set: async object => Object.assign(data, object), remove: async key => { for (const k of [].concat(key)) delete data[k]; } } },
    tabs: { query: async () => [{ ...tab }], captureVisibleTab: async (...args) => { captureCalls.push(args); return 'data:image/jpeg;base64,AA=='; }, sendMessage: async (id, message) => message.type === 'READ_PAGE' ? { page: { ...page }, element: null } : { ok: true } },
    scripting: { executeScript: async () => [] }, windows: {}
  };
  for (const event of ['onActivated', 'onUpdated', 'onRemoved']) chrome.tabs[event] = { addListener: fn => events[event] = fn };
  chrome.windows.onRemoved = { addListener: () => {} };
  const sessionMock = { install() {}, forCapture: async () => null, command: async () => ({ diagnostics: null }), hello: async () => ({ active: false }), append: async () => ({ accepted: false }) };
  vm.runInNewContext(source, { chrome, console, UI_VERSION, RUNTIME_PROTOCOL, createSessionManager: () => sessionMock });
  const send = (message, sender = { url: 'chrome-extension://test/sidepanel.html' }) => new Promise(resolve => listener(message, sender, resolve));
  return { send, tab, data, chrome, captureCalls, events, sessionMock };
}
test('Capture returns metadata and screenshot for the active authorized tab', async () => {
  const h = setup(); const result = await h.send({ type: 'CAPTURE', windowId: 1, requestId: 'a' });
  assert.equal(result.ok, true); assert.equal(result.result.tabId, 5); assert.equal(result.result.requestId, 'a'); assert.equal(h.captureCalls.length, 1);
});
test('Runtime handshake identifies the worker code and rejects page callers', async () => {
  const h = setup(); let commands = 0;
  h.sessionMock.command = async () => { commands++; };
  const result = await h.send({ type: 'RUNTIME_INFO' });
  assert.equal(result.ok, true);
  assert.equal(result.runtime.version, UI_VERSION);
  assert.equal(result.runtime.protocol, RUNTIME_PROTOCOL);
  assert.equal(commands, 0);
  assert.equal((await h.send({ type: 'RUNTIME_INFO' }, { tab: h.tab, url: h.tab.url })).ok, false);
});
test('Rejects privileged pages and commands from content scripts', async () => {
  const h = setup(); h.tab.url = 'chrome://settings';
  assert.equal((await h.send({ type: 'CAPTURE', windowId: 1 })).ok, false); assert.equal(h.captureCalls.length, 0);
  assert.equal((await h.send({ type: 'CAPTURE', windowId: 1 }, { tab: h.tab, url: h.tab.url })).ok, false);
});
test('Tab changes during capture cannot attach the wrong screenshot', async () => {
  const h = setup(); h.chrome.tabs.captureVisibleTab = async () => { h.tab.id = 99; return 'wrong-image'; };
  const result = await h.send({ type: 'CAPTURE', windowId: 1, requestId: 'a' });
  assert.equal(result.ok, false); assert.match(result.error, /页面已变化/);
});
test('Only matching top-frame selection requests may produce a report', async () => {
  const h = setup(); await h.send({ type: 'PICK', windowId: 1, requestId: 'correct' });
  await h.send({ type: 'PICK_RESULT', requestId: 'stale', data: { page: { url: h.tab.url } } }, { tab: h.tab, frameId: 0 });
  assert.equal(h.captureCalls.length, 0);
  await h.send({ type: 'PICK_RESULT', requestId: 'correct', data: { page: { url: h.tab.url } } }, { tab: h.tab, frameId: 1 });
  assert.equal(h.captureCalls.length, 0);
  await h.send({ type: 'PICK_RESULT', requestId: 'correct', data: { page: { url: h.tab.url }, element: { selector: '#test' } } }, { tab: h.tab, frameId: 0 });
  assert.equal(h.data['capture:1'].element.selector, '#test'); assert.equal(h.data['pick:1'], undefined);
});
test('Escape cancellation persists a result and clears the pending request', async () => {
  const h = setup(); await h.send({ type: 'PICK', windowId: 1, requestId: 'cancel' });
  await h.send({ type: 'PICK_CANCELLED', requestId: 'cancel' }, { tab: h.tab, frameId: 0 });
  assert.equal(h.data['capture:1'].cancelled, true); assert.equal(h.data['pick:1'], undefined);
});

test('Diagnostics commands are delegated to the session manager and never accepted from pages', async () => {
  const h = setup(); let call;
  h.sessionMock.command = async args => { call = args; return { diagnostics: { sessionId: 'session' } }; };
  const result = await h.send({ type: 'DIAGNOSTICS', action: 'start', windowId: 1 });
  assert.equal(call.action, 'start'); assert.equal(result.diagnostics.sessionId, 'session');
  assert.equal((await h.send({ type: 'DIAGNOSTICS', action: 'start', windowId: 1 }, { tab: h.tab })).ok, false);
});
test('Capture attaches session evidence through the page-specific lookup', async () => {
  const h = setup(); let id;
  h.sessionMock.forCapture = async tabId => { id = tabId; return { scope: 'test-session', sessionId: 'session' }; };
  const result = await h.send({ type: 'CAPTURE', windowId: 1, requestId: 'a' });
  assert.equal(id, 5); assert.equal(result.result.diagnostics.scope, 'test-session');
});
test('Toolbar invocation uses action.onClicked and opens the panel within the user gesture', () => {
  const h = setup(); assert.equal(h.events.panelBehavior.openPanelOnActionClick, false);
  h.events.toolbarClick(h.tab); assert.equal(h.events.panelOpened.windowId, 1);
});
test('Missing activeTab access is distinguished from an actual restricted page', async () => {
  const h = setup(); delete h.tab.url;
  const denied = await h.send({ type: 'CAPTURE', windowId: 1 });
  assert.match(denied.error, /临时访问权限/); assert.ok(!denied.error.includes('内置'));
  h.tab.url = 'chrome://newtab/';
  assert.match((await h.send({ type: 'CAPTURE', windowId: 1 })).error, /内置/);
  assert.equal(h.captureCalls.length, 0);
});
