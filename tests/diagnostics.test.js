import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pageDiagnostics, sanitizeDiagnostics } from '../diagnostics.js';
function harness() {
  const events = new Map(), consoleCalls = [];
  class FakeXHR {
    listeners = new Map(); status = 200;
    open(method, url) { this.method = method; this.url = url; return 'opened'; }
    send(body) { this.body = body; return 'sent'; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name) { this.listeners.delete(name); }
    end(status) { this.status = status; this.listeners.get('loadend')?.(); }
  }
  const context = { URL, Request, Error, Element: class {}, XMLHttpRequest: FakeXHR, performance: { timeOrigin: 123 }, location: { href: 'https://example.com/login?token=secret' }, console: { error: (...args) => { consoleCalls.push(args); return 'console-result'; } }, setTimeout: () => 1, clearTimeout: () => {} };
  context.window = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name), fetch: async () => ({ status: 200 }) };
  const page = vm.createContext(context); vm.runInContext(`var run = ${pageDiagnostics.toString()}`, page);
  return { run: action => page.run(action), page, events, consoleCalls, FakeXHR };
}
test('Monitor records console errors and runtime events without changing console behavior', () => {
  const h = harness(), original = h.page.console.error; h.run('start');
  assert.equal(h.page.console.error('token=abc', { password: 'secret' }), 'console-result');
  h.events.get('error')({ target: h.page.window, message: 'TypeError', filename: 'https://e.test/a.js?key=secret', lineno: 3 });
  h.events.get('unhandledrejection')({ reason: new Error('rejected') });
  const result = h.run('read'); assert.equal(result.errors.length, 3);
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('abc'));
  assert.equal(result.errors[0].kind, 'console.error'); assert.equal(h.consoleCalls.length, 1);
  h.run('stop'); assert.equal(h.page.console.error, original); assert.equal(h.events.size, 0);
});
test('Fetch preserves response and error objects while collecting HTTP and network failures', async () => {
  const h = harness(), response = { status: 500 }, error = new Error('offline');
  h.page.window.fetch = async url => { if (url.includes('offline')) throw error; return response; };
  const original = h.page.window.fetch; h.run('start');
  assert.equal(await h.page.window.fetch('https://e.test/api?token=secret', { method: 'POST', body: 'private' }), response);
  await assert.rejects(h.page.window.fetch('https://e.test/offline'), value => value === error);
  const result = h.run('read'); assert.equal(result.requests.length, 2); assert.equal(result.requests[0].method, 'POST');
  assert.equal(result.requests[0].url, 'https://e.test/api'); assert.ok(!JSON.stringify(result).includes('private'));
  h.run('stop'); assert.equal(h.page.window.fetch, original);
});
test('XHR preserves calls and captures failures; stopping does not undo later page wrappers', () => {
  const h = harness(), originalOpen = h.FakeXHR.prototype.open; h.run('start');
  const xhr = new h.FakeXHR(); assert.equal(xhr.open('GET', '/api?token=secret'), 'opened'); assert.equal(xhr.send('private'), 'sent'); xhr.end(404);
  assert.equal(h.run('read').requests[0].status, 404); assert.equal(xhr.body, 'private');
  const replacement = () => {}; h.page.console.error = replacement; h.run('stop'); assert.equal(h.page.console.error, replacement); assert.equal(h.FakeXHR.prototype.open, originalOpen);
});
test('Repeated starts are idempotent, buffers are bounded, and clear resets counts', () => {
  const h = harness(); h.run('start'); const wrapped = h.page.console.error; h.run('start'); assert.equal(h.page.console.error, wrapped);
  for (let i = 0; i < 105; i++) h.page.console.error(`error ${i}`);
  assert.equal(h.run('read').errors.length, 100); assert.equal(h.run('read').dropped.errors, 5);
  h.run('clear'); assert.equal(h.run('read').errors.length, 0); assert.equal(h.run('read').dropped.errors, 0);
});
test('Sanitizer drops extra fields, bounds strings and refuses malformed status values', () => {
  const result = sanitizeDiagnostics({ active: 'yes', errors: new Array(150).fill({ message: 'x'.repeat(3000), secret: 'private' }), requests: [{ status: 999, headers: { token: 'private' } }], dropped: { errors: -2 } });
  assert.equal(result.active, false); assert.equal(result.errors.length, 100); assert.equal(result.errors[0].message.length, 2000);
  assert.equal(result.requests[0].status, null); assert.equal(result.dropped.errors, 0); assert.ok(!JSON.stringify(result).includes('private'));
});
test('Starting diagnostics has no automatic timeout', () => {
  const h = harness(); h.page.setTimeout = () => { throw new Error('Must not schedule an automatic stop'); };
  assert.equal(h.run('start').active, true); assert.equal(h.run('read').active, true);
  h.run('stop'); assert.equal(h.run('read').active, false);
});
test('Reconnecting a stream in the same document generates new event IDs', () => {
  const h = harness(), emitted = [];
  h.page.crypto = crypto;
  h.page.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  h.page.window.dispatchEvent = event => emitted.push(JSON.parse(event.detail));
  const options = { sessionId: 'one-session', eventName: 'bugsnap-stream-token' };
  h.page.run('start', options); h.page.console.error('first'); h.page.run('stop');
  h.page.run('start', options); h.page.console.error('second');
  assert.equal(emitted.length, 2); assert.notEqual(emitted[0].entry.id, emitted[1].entry.id);
  assert.equal(emitted[1].sessionId, 'one-session');
});
test('A request that never completes still leaves a request-start record', () => {
  const h = harness(); h.page.window.fetch = () => new Promise(() => {}); h.run('start');
  h.page.window.fetch('https://e.test/wait');
  assert.equal(h.run('read').network[0].kind, 'fetch-start'); assert.equal(h.run('read').network[0].url, 'https://e.test/wait');
  h.run('stop');
});
