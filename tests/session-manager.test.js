import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../session-manager.js';
import { diagnosticAttachment } from '../diagnostic-state.js';
const clone = value => value === undefined ? undefined : structuredClone(value);
function harness() {
  const sessions = new Map(), events = new Map(), local = {}, volatile = {}, hooks = {}, injections = [], registrations = [];
  let granted = true, number = 0;
  const db = {
    get: async id => clone(sessions.get(id)), put: async s => { sessions.set(s.id, clone(s)); }, list: async () => [...sessions.values()].map(clone),
    append: async (s, e) => { const key = `${s.id}:${e.id}`; if (events.has(key)) return false; events.set(key, clone({ ...e, sessionId: s.id })); s.counts[e.category]++; sessions.set(s.id, clone(s)); return true; },
    events: async (id, limits) => { const all = [...events.values()].filter(e => e.sessionId === id); if (!limits) return clone(all); return clone(Object.keys(limits).flatMap(category => { const a = all.filter(e => e.category === category); return limits[category] ? a.slice(-limits[category]) : []; })); },
    clear: async s => { for (const [key, e] of events) if (e.sessionId === s.id) events.delete(key); sessions.set(s.id, clone(s)); }
  };
  const area = data => ({ get: async key => ({ [key]: clone(data[key]) }), set: async object => Object.assign(data, clone(object)) });
  const tab = { id: 5, windowId: 1, url: 'https://a.test/login' };
  const chrome = {
    storage: { local: area(local), session: area(volatile) }, permissions: { contains: async () => granted, onRemoved: { addListener: fn => hooks.permissionRemoved = fn } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    scripting: { getRegisteredContentScripts: async () => clone(registrations), registerContentScripts: async scripts => registrations.push(...clone(scripts)), unregisterContentScripts: async () => { registrations.length = 0; }, executeScript: async args => { injections.push(args); return []; } },
    tabs: { get: async id => ({ ...clone(tab), id }), query: async () => [clone(tab)], captureVisibleTab: async () => 'data:image/jpeg;base64,AA==', sendMessage: async () => ({ ok: true }) }
  };
  for (const name of ['onCreated', 'onUpdated', 'onRemoved', 'onActivated']) { hooks[name] = []; chrome.tabs[name] = { addListener: fn => hooks[name].push(fn) }; }
  const makeManager = () => createSessionManager(chrome, db, () => `uuid-${++number}`);
  const manager = makeManager(); manager.install();
  const sender = (doc = 'doc-a', id = 5, url = tab.url) => ({ tab: { ...tab, id }, frameId: 0, documentId: doc, url });
  const hello = (doc = 'doc-a', id = 5, url) => manager.hello({ token: `token-${doc}`, pageDocumentId: `time-${doc}`, title: doc }, sender(doc, id, url));
  const event = async (sessionId, sequence, doc = 'doc-a', id = 5, url = tab.url) => manager.append({ sessionId, token: `token-${doc}`, category: 'errors', entry: { id: `token-${doc}:${sequence}`, kind: 'console.error', message: `error-${sequence}`, time: new Date().toISOString(), pageUrl: url } }, sender(doc, id, url));
  return { manager, makeManager, db, chrome, tab, sessions, events, local, volatile, hooks, injections, registrations, sender, hello, event, permission: value => granted = value };
}
const start = h => h.manager.command({ action: 'start', windowId: 1 });
test('A session continues across origins and preserves each document until manual stop', async () => {
  const h = harness(), { sessionId } = await start(h);
  await h.hello(); await h.event(sessionId, 1);
  h.tab.url = 'https://b.test/home'; await h.hello('doc-b'); await h.event(sessionId, 1, 'doc-b');
  const read = await h.manager.command({ action: 'read', full: true });
  assert.equal(read.diagnostics.active, true); assert.equal(read.diagnostics.errors.length, 2); assert.equal(read.diagnostics.pages.length, 2);
  assert.deepEqual(read.diagnostics.errors.map(e => e.pageUrl), ['https://a.test/login', 'https://b.test/home']);
  const capture = { tabId: 5, page: { url: h.tab.url, documentId: 'time-doc-b' } };
  assert.equal(diagnosticAttachment(capture, read).ok, true);
  assert.equal(h.registrations[0].runAt, 'document_start');
});
test('Unrelated tabs and forged session/token/frame events cannot write records', async () => {
  const h = harness(), { sessionId } = await start(h);
  assert.equal((await h.hello('foreign', 99)).active, false); await h.hello();
  assert.equal((await h.event('wrong-session', 1)).accepted, false);
  assert.equal((await h.manager.append({ sessionId, token: 'wrong' }, h.sender())).accepted, false);
  assert.equal((await h.manager.hello({ token: 'fake' }, { ...h.sender(), frameId: 2 })).active, false);
  assert.equal((await h.manager.command({ action: 'read' })).diagnostics.counts.errors, 0);
});
test('Stopping from a different or restricted active page works and rejects later events', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello(); await h.event(sessionId, 1);
  h.tab.url = 'chrome://settings/';
  const stopped = await h.manager.command({ action: 'stop', sessionId });
  assert.equal(stopped.diagnostics.active, false); assert.equal(h.registrations.length, 0);
  assert.equal((await h.event(sessionId, 2)).accepted, false);
  assert.equal((await h.manager.command({ action: 'read', full: true })).diagnostics.errors.length, 1);
});
test('Worker recreation retains active state, bindings and events without restarting collection', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello(); await h.event(sessionId, 1);
  const next = h.makeManager();
  assert.equal((await next.command({ action: 'read' })).diagnostics.active, true);
  assert.equal((await next.hello({ token: 'next-token', pageDocumentId: 'time-doc-b' }, h.sender('doc-b'))).active, true);
  assert.equal((await next.command({ action: 'read', full: true })).diagnostics.errors.length, 1);
});
test('Browser restart keeps evidence but does not attach stale tab IDs to unrelated new tabs', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello(); await h.event(sessionId, 1);
  delete h.volatile.sessionBrowserId;
  const next = h.makeManager(), read = await next.command({ action: 'read', full: true });
  assert.equal(read.diagnostics.active, true); assert.equal(read.diagnostics.status, 'waiting'); assert.deepEqual(read.diagnostics.tabIds, []);
  assert.equal(read.diagnostics.errors.length, 1);
  assert.equal((await next.hello({ token: 'new', pageDocumentId: 'new-doc' }, h.sender('new'))).active, false);
  await next.command({ action: 'join', windowId: 1 });
  assert.equal((await next.hello({ token: 'new', pageDocumentId: 'new-doc' }, h.sender('new'))).active, true);
});
test('Live preview is bounded but full export retains more than 100 events without a timer stop', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello();
  for (let i = 1; i <= 130; i++) await h.event(sessionId, i);
  const preview = await h.manager.command({ action: 'read' }), full = await h.manager.command({ action: 'read', full: true });
  assert.equal(preview.diagnostics.errors.length, 100); assert.equal(preview.diagnostics.truncated, true);
  assert.equal(full.diagnostics.errors.length, 130); assert.equal(full.diagnostics.counts.errors, 130); assert.equal(full.diagnostics.active, true);
  await h.event(sessionId, 130); assert.equal((await h.manager.command({ action: 'read' })).diagnostics.counts.errors, 130);
});
test('Child tabs join automatically; unrelated tabs must be joined explicitly', async () => {
  const h = harness(); await start(h);
  h.hooks.onCreated[0]({ id: 6, openerTabId: 5, url: 'https://b.test/' });
  h.hooks.onCreated[0]({ id: 7, openerTabId: 99, url: 'https://b.test/' });
  const read = await h.manager.command({ action: 'read' }); assert.deepEqual(read.diagnostics.tabIds, [5, 6]);
  h.hooks.onRemoved[0](5); h.hooks.onRemoved[0](6);
  const empty = await h.manager.command({ action: 'read' }); assert.equal(empty.diagnostics.active, true); assert.equal(empty.diagnostics.status, 'waiting');
});
test('Permission refusal never starts a session; clearing does not stop an active session', async () => {
  const h = harness(); h.permission(false); await assert.rejects(start(h), /授权/); assert.equal(h.sessions.size, 0);
  h.permission(true); const { sessionId } = await start(h); await h.hello(); await h.event(sessionId, 1);
  const cleared = await h.manager.command({ action: 'clear', sessionId }); assert.equal(cleared.diagnostics.counts.errors, 0); assert.equal(cleared.diagnostics.active, true);
  await h.event(sessionId, 2); assert.equal((await h.manager.command({ action: 'read' })).diagnostics.counts.errors, 1);
});
test('Completed sessions stay independently readable after a new session starts', async () => {
  const h = harness(), old = await start(h); await h.hello(); await h.event(old.sessionId, 1); await h.manager.command({ action: 'stop' });
  const next = await start(h); assert.notEqual(next.sessionId, old.sessionId);
  assert.equal((await h.manager.command({ action: 'read', sessionId: old.sessionId, full: true })).diagnostics.errors.length, 1);
  assert.equal((await h.manager.command({ action: 'list' })).sessions.length, 2);
  await assert.rejects(h.manager.command({ action: 'stop', sessionId: old.sessionId }), /已变化/);
});
test('Storage failure is surfaced instead of silently claiming the event was saved', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello();
  h.db.append = async () => { throw new Error('QuotaExceeded'); };
  const result = await h.event(sessionId, 1); assert.equal(result.accepted, false); assert.match(h.local.diagnosticSessionStatus.error, /保存失败/);
  const read = await h.manager.command({ action: 'read', full: true }); assert.equal(read.diagnostics.dropped.errors, 1); assert.equal(read.diagnostics.status, 'storage-error');
});

test('Revoking optional site permission pauses collection without erasing the session', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello(); await h.event(sessionId, 1);
  h.permission(false); h.hooks.permissionRemoved();
  const read = await h.manager.command({ action: 'read' });
  assert.equal(read.diagnostics.active, true); assert.equal(read.diagnostics.status, 'permission');
  assert.equal((await h.event(sessionId, 2)).accepted, false); assert.equal(read.diagnostics.counts.errors, 1);
});
test('Clearing an archived session does not replace or stop the current active session', async () => {
  const h = harness(), old = await start(h); await h.hello(); await h.event(old.sessionId, 1); await h.manager.command({ action: 'stop' });
  const current = await start(h); await h.manager.command({ action: 'clear', sessionId: old.sessionId });
  assert.equal(h.local.diagnosticSessionId, current.sessionId);
  assert.equal((await h.manager.command({ action: 'read' })).diagnostics.active, true);
  assert.equal((await h.manager.command({ action: 'read', sessionId: old.sessionId, full: true })).diagnostics.errors.length, 0);
});
test('A completed page that refuses injection is shown as a collection gap', async () => {
  const h = harness(); await start(h);
  h.chrome.scripting.executeScript = async () => { throw new Error('Cannot access page'); };
  h.hooks.onUpdated[0](5, { status: 'complete' }, h.tab);
  const result = await h.manager.command({ action: 'read' });
  assert.equal(result.diagnostics.active, true); assert.equal(result.diagnostics.status, 'waiting'); assert.match(result.diagnostics.lastError, /未能接入/);
});
test('Simple mode follows activated tabs in the recording window only', async () => {
  const h = harness(); await h.manager.command({ action: 'start', windowId: 1, followActive: true });
  h.hooks.onActivated[0]({ tabId: 8, windowId: 1 }); h.hooks.onActivated[0]({ tabId: 9, windowId: 2 });
  const read = await h.manager.command({ action: 'read', full: true });
  assert.deepEqual(read.diagnostics.tabIds, [5, 8]); assert.ok(read.diagnostics.navigation.some(e => e.kind === 'tab-switch'));
});
test('Problem markers survive screenshot denial and can be exported without a title', async () => {
  const h = harness(); await h.manager.command({ action: 'start', windowId: 1, screenshots: true });
  h.chrome.tabs.captureVisibleTab = async () => { throw new Error('activeTab permission required'); };
  const result = await h.manager.command({ action: 'mark', windowId: 1 });
  assert.equal(result.diagnostics.counts.markers, 1); assert.equal(result.evidence.saved, false);
  assert.equal((await h.manager.command({ action: 'read', full: true })).diagnostics.markers.length, 1);
});
test('Stop waits for bridge acknowledgement so the last pending input reaches storage', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello();
  h.chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.type === 'SESSION_STOP') await h.manager.append({ sessionId, token: 'token-doc-a', category: 'actions', entry: { id: 'token-doc-a:last-input', kind: 'input', message: '填写了字段', state: '已填写' } }, h.sender());
    return { ok: true };
  };
  await h.manager.command({ action: 'stop' });
  const full = await h.manager.command({ action: 'read', full: true });
  assert.equal(full.diagnostics.active, false); assert.equal(full.diagnostics.counts.actions, 1);
  assert.equal(full.diagnostics.timeline.find(e => e.category === 'actions').state, '已填写');
});
test('Successful request summaries and UI business failures are retained together', async () => {
  const h = harness(), { sessionId } = await start(h); await h.hello();
  for (const [category, entry] of [['network', { kind: 'fetch', status: 200, url: 'https://a.test/save', duration: 32 }], ['feedback', { kind: 'page-message', message: '页面显示：保存失败' }]]) {
    await h.manager.append({ sessionId, token: 'token-doc-a', category, entry: { id: `token-doc-a:${category}`, ...entry } }, h.sender());
  }
  const d = (await h.manager.command({ action: 'read', full: true })).diagnostics;
  assert.equal(d.network[0].status, 200); assert.match(d.feedback[0].message, /保存失败/);
});
test('A new tab first opened as chrome://newtab is adopted after navigating to a website', async () => {
  const h = harness(); await h.manager.command({ action: 'start', windowId: 1, followActive: true });
  const tab = { id: 77, windowId: 1, active: true, url: 'https://new.test/' };
  h.hooks.onUpdated[0](77, { status: 'loading' }, tab);
  const read = await h.manager.command({ action: 'read' }); assert.ok(read.diagnostics.tabIds.includes(77));
});
test('An old running session does not silently start recording actions after upgrade', async () => {
  const h = harness(), { sessionId } = await start(h);
  const old = await h.db.get(sessionId); delete old.recordingVersion; await h.db.put(old);
  h.injections.length = 0; await h.hello();
  assert.ok(!h.injections.some(x => x.func?.name === 'installInteractionRecorder'));
  const diagnosticsCall = h.injections.find(x => x.func?.name === 'pageDiagnostics');
  assert.equal(diagnosticsCall.args[1].recordNetwork, false);
});
test('Returning to a cached document adds a visit without duplicating repeated handshakes', async () => {
  const h = harness(); await start(h); await h.hello('doc-a'); await h.hello('doc-a');
  await h.hello('doc-b'); await h.hello('doc-a');
  const d = (await h.manager.command({ action: 'read', full: true })).diagnostics;
  assert.equal(d.pages.length, 2); assert.equal(d.counts.navigation, 3);
  assert.match(d.navigation.at(-1).message, /返回/);
});
test('Simple mode does not adopt a reused window ID automatically after browser restart', async () => {
  const h = harness(); await h.manager.command({ action: 'start', windowId: 1, followActive: true });
  delete h.volatile.sessionBrowserId;
  const next = h.makeManager();
  const sender = { ...h.sender('after-restart'), tab: { ...h.tab, active: true } };
  assert.equal((await next.hello({ token: 'new-token', pageDocumentId: 'new-page' }, sender)).active, false);
  assert.deepEqual((await next.command({ action: 'read' })).diagnostics.tabIds, []);
});
