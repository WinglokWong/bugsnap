import test from 'node:test';
import assert from 'node:assert/strict';
import { setupEasyUI } from '../easy-ui.js';
import { UI_VERSION, RuntimeCompatibilityError } from '../runtime-compat.js';

function setup({ granted = true } = {}) {
  const nodes = new Map(), calls = [], failures = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', value: '', hidden: false, disabled: false, checked: true,
      classList: { toggle() {}, remove() {} }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      replaceChildren() {}, append() {}
    });
    return nodes.get(id);
  };
  globalThis.document = { getElementById: node, activeElement: null, createElement: () => node(Symbol()) };
  let manifest = { version: UI_VERSION, optional_host_permissions: ['<all_urls>'] }, session = null;
  globalThis.chrome = {
    runtime: { getManifest: () => manifest },
    permissions: { request(options) { calls.push(['permission', options]); return Promise.resolve(granted); } },
    storage: { onChanged: { addListener() {} } }
  };
  let commandError;
  const ui = setupEasyUI({
    extension: true, getWindowId: () => 1, download() {}, notify() {},
    command: async (_, args) => {
      calls.push(['command', args.action]);
      if (commandError) throw commandError;
      if (args.action === 'start') session = { active: true, recordingVersion: 2, status: 'recording', timeline: [], sessionId: 'test' };
      return { diagnostics: session, sessions: [] };
    },
    onRuntimeError(error) { failures.push(error); ui.setReady(false, { title: '重新加载后就能开始' }); }
  });
  return { ui, node, calls, failures, click: id => node(id).listeners.click(), oldManifest() { manifest.version = '1.2.0'; }, failCommands(error) { commandError = error; } };
}
test('Recording cannot request permissions while startup is still being checked', async () => {
  const h = setup();
  assert.equal(h.node('easy-start').disabled, true);
  await h.click('easy-start');
  assert.deepEqual(h.calls, []);
});
test('Ready Start requests permissions synchronously before any background command', async () => {
  const h = setup(); h.ui.setReady(true);
  const pending = h.click('easy-start');
  assert.deepEqual(h.calls, [['permission', { origins: ['<all_urls>'] }]]);
  await pending;
  assert.deepEqual(h.calls.map(call => call[1]?.origins ? 'permission' : call[1]), ['permission', 'start', 'evidence', 'list', 'read']);
  assert.match(h.node('easy-status-title').textContent, /正在记录/);
});
test('A stale manifest discovered on click never requests permission or starts recording', async () => {
  const h = setup(); h.ui.setReady(true); h.oldManifest();
  await h.click('easy-start');
  assert.deepEqual(h.calls, []);
  assert.equal(h.failures.length, 1);
  assert.equal(h.node('easy-start').disabled, true);
  assert.equal(h.node('easy-status-title').textContent, '重新加载后就能开始');
});
test('Refusing optional permissions leaves Start available without a reload warning', async () => {
  const h = setup({ granted: false }); h.ui.setReady(true);
  await h.click('easy-start');
  assert.equal(h.failures.length, 0);
  assert.ok(!h.calls.some(call => call[1] === 'start'));
  assert.equal(h.node('easy-start').disabled, false);
  assert.match(h.node('easy-message').textContent, /还没有得到浏览器允许/);
});
test('A compatibility failure during an active recording cannot render a false recording status', async () => {
  const h = setup(); h.ui.setReady(true); await h.click('easy-start');
  h.failCommands(new RuntimeCompatibilityError());
  await h.click('easy-mark');
  assert.equal(h.node('easy-status-title').textContent, '重新加载后就能开始');
  assert.equal(h.node('easy-mark').disabled, true);
  assert.equal(h.node('easy-end').disabled, true);
  assert.equal(h.failures.length, 1);
});
