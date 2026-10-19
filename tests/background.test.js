import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { UI_VERSION, RUNTIME_PROTOCOL } from '../runtime-compat.js';
const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
function setup() {
  let listener; const events = {};
  const chrome = {
    sidePanel: { setPanelBehavior: async options => { events.panelBehavior = options; }, open: async options => { events.panelOpened = options; } },
    action: { onClicked: { addListener: fn => events.toolbarClick = fn } },
    runtime: { getURL: () => 'chrome-extension://test/', onMessage: { addListener: fn => listener = fn } }
  };
  const sessionMock = { install() {}, command: async () => ({ diagnostics: null }), hello: async () => ({ active: false }), append: async () => ({ accepted: false }) };
  vm.runInNewContext(source, { chrome, console, UI_VERSION, RUNTIME_PROTOCOL, createSessionManager: () => sessionMock });
  const send = (message, sender = { url: 'chrome-extension://test/sidepanel.html' }) => new Promise(resolve => listener(message, sender, resolve));
  return { send, events, sessionMock };
}
test('Runtime handshake identifies worker code', async () => {
  const h = setup(), result = await h.send({ type: 'RUNTIME_INFO' });
  assert.equal(result.ok, true); assert.equal(result.runtime.version, UI_VERSION); assert.equal(result.runtime.protocol, RUNTIME_PROTOCOL);
});
test('Only the extension UI can delete or command recordings', async () => {
  const h = setup(); let call;
  h.sessionMock.command = async args => { call = args; return { deleted: true }; };
  const result = await h.send({ type: 'DIAGNOSTICS', action: 'delete', sessionId: 'one' });
  assert.equal(result.deleted, true); assert.equal(call.sessionId, 'one'); call = null;
  for (const sender of [{ tab: { id: 1 }, url: 'https://example.com/' }, { url: 'https://example.com/' }, {}]) {
    assert.equal((await h.send({ type: 'DIAGNOSTICS', action: 'delete' }, sender)).ok, false);
    assert.equal((await h.send({ type: 'RUNTIME_INFO' }, sender)).ok, false);
  }
  assert.equal(call, null);
});
test('Content-script data is forwarded to session validation', async () => {
  const h = setup(); const sender = { tab: { id: 1 }, frameId: 0, documentId: 'doc' }; let received;
  h.sessionMock.append = async (message, origin) => { received = { message, origin }; return { accepted: true }; };
  assert.equal((await h.send({ type: 'SESSION_EVENT', sessionId: 'session' }, sender)).accepted, true);
  assert.equal(received.origin, sender); assert.equal(received.message.sessionId, 'session');
});
test('Removed advanced commands cannot trigger page capture or selection', async () => {
  const h = setup();
  for (const type of ['PICK', 'CAPTURE', 'CANCEL', 'PICK_RESULT']) assert.equal((await h.send({ type })).ok, false);
});
test('Toolbar opens the panel inside the click gesture', () => {
  const h = setup(); assert.equal(h.events.panelBehavior.openPanelOnActionClick, false);
  h.events.toolbarClick({ windowId: 1 }); assert.equal(h.events.panelOpened.windowId, 1);
});
