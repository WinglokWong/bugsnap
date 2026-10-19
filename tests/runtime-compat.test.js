import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UI_VERSION, RUNTIME_PROTOCOL, RELOAD_MESSAGE, RuntimeCompatibilityError,
  assertLoadedManifest, assertRuntimeInfo, checkRuntime, permissionOrigins, runtimeProblem
} from '../runtime-compat.js';

const currentManifest = () => ({ version: UI_VERSION, optional_host_permissions: ['<all_urls>'] });
const currentReply = () => ({ ok: true, runtime: { version: UI_VERSION, protocol: RUNTIME_PROTOCOL } });

function api(manifest = currentManifest(), reply = currentReply()) {
  const calls = [];
  return {
    calls,
    runtime: {
      getManifest() { calls.push('manifest'); return manifest; },
      async sendMessage(message) { calls.push(message); return reply; }
    }
  };
}

test('The shared runtime contract accepts the current manifest and worker', () => {
  assert.equal(UI_VERSION, '2.0.1');
  assert.equal(RUNTIME_PROTOCOL, 1);
  const manifest = currentManifest(), reply = currentReply();
  assert.equal(assertLoadedManifest(manifest), manifest);
  assert.equal(assertRuntimeInfo(reply), reply.runtime);
  assert.match(RELOAD_MESSAGE, /重新加载插件/);
  assertLoadedManifest(JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')));
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, UI_VERSION);
});

test('Old manifests and insufficient optional permissions require a reload', () => {
  for (const manifest of [
    null, {}, { ...currentManifest(), version: '1.2.0' },
    { ...currentManifest(), version: '2.0.0' },
    { version: UI_VERSION },
    { version: UI_VERSION, optional_host_permissions: '<all_urls>' },
    { version: UI_VERSION, optional_host_permissions: [] },
    { version: UI_VERSION, optional_host_permissions: ['http://*/*', 'https://*/*'] },
    { version: UI_VERSION, optional_host_permissions: ['*://*/*'] }
  ]) assert.throws(() => assertLoadedManifest(manifest), RuntimeCompatibilityError);
});

test('Manifest mismatch prevents a background request', async () => {
  const chromeApi = api({ ...currentManifest(), version: '1.2.0' });
  await assert.rejects(checkRuntime(chromeApi), RuntimeCompatibilityError);
  assert.deepEqual(chromeApi.calls, ['manifest']);
});

test('A current manifest with a legacy or mismatched worker is rejected', async () => {
  for (const reply of [
    { ok: true }, { ok: true, runtime: {} },
    { ok: true, runtime: { version: '2.0.0', protocol: RUNTIME_PROTOCOL } },
    { ok: true, runtime: { version: UI_VERSION, protocol: 0 } },
    { ok: true, runtime: { version: UI_VERSION, protocol: '1' } }
  ]) {
    const chromeApi = api(currentManifest(), reply);
    await assert.rejects(checkRuntime(chromeApi), RuntimeCompatibilityError);
    assert.deepEqual(chromeApi.calls, ['manifest', { type: 'RUNTIME_INFO' }]);
  }
});

test('The normal handshake returns worker capabilities after checking the manifest', async () => {
  const chromeApi = api();
  assert.deepEqual(await checkRuntime(chromeApi), currentReply().runtime);
  assert.deepEqual(chromeApi.calls, ['manifest', { type: 'RUNTIME_INFO' }]);
});

test('Permission origins are validated synchronously without messaging the worker', () => {
  const chromeApi = api();
  assert.deepEqual(permissionOrigins(chromeApi, true), ['<all_urls>']);
  assert.deepEqual(permissionOrigins(chromeApi, false), ['http://*/*', 'https://*/*']);
  assert.deepEqual(chromeApi.calls, ['manifest', 'manifest']);
  const stale = api({ ...currentManifest(), version: '1.2.0' });
  assert.throws(() => permissionOrigins(stale, true), RuntimeCompatibilityError);
  assert.deepEqual(stale.calls, ['manifest']);
});

test('Known stale-install and invalid-context errors have one actionable message', () => {
  for (const error of [
    new RuntimeCompatibilityError(),
    new Error('Only permissions specified in the manifest may be requested.'),
    new Error('无效的记录操作。'),
    new Error('无效的会话操作。'),
    new Error('Extension context invalidated.'),
    new Error('Could not establish connection. Receiving end does not exist.'),
    'Extension context invalidated.'
  ]) assert.equal(runtimeProblem(error), RELOAD_MESSAGE);
});

test('Denied authorization and unrelated failures are not labeled as version mismatches', () => {
  for (const error of [
    new Error('The user denied permission.'),
    new Error('还没有得到浏览器允许。'),
    new Error('Permissions request must be called from a user gesture.'),
    new Error('The message port closed before a response was received.'),
    new Error('Network timeout'),
    new Error('QuotaExceededError'),
    new Error('Cannot access contents of url')
  ]) assert.equal(runtimeProblem(error), null);
});

test('Other handshake failures preserve their actual reason', async () => {
  const failure = new Error('Storage unavailable');
  const chromeApi = api();
  chromeApi.runtime.sendMessage = async () => { throw failure; };
  await assert.rejects(checkRuntime(chromeApi), error => error === failure);
  assert.equal(runtimeProblem(failure), null);
  for (const reply of [null, undefined, { ok: false, error: 'Database unavailable' }]) {
    assert.throws(() => assertRuntimeInfo(reply), error => {
      assert.equal(error instanceof RuntimeCompatibilityError, false);
      assert.equal(runtimeProblem(error), null);
      if (reply?.error) assert.equal(error.message, reply.error);
      return true;
    });
  }
});
