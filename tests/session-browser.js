import { createSessionManager } from '../session-manager.js';
import { sessionDB } from '../session-db.js';
const local = {}, volatile = {}, calls = new Map(), registrations = [];
let ready = false, docId, manager, failures = 0;
const frame = document.getElementById('page');
const tab = { id: 550, windowId: 100, url: new URL('./session-page.html?phase=a', location.href).href };
const area = object => ({ get: async key => ({ [key]: object[key] }), set: async value => Object.assign(object, structuredClone(value)) });
function call(action, args) { return new Promise((resolve, reject) => { const id = crypto.randomUUID(); const timer = setTimeout(() => { calls.delete(id); reject(new Error(`页面操作超时：${action}`)); }, 5000); calls.set(id, value => { clearTimeout(timer); resolve(value); }); frame.contentWindow.postMessage({ fixture: 'call', id, action, args }, '*'); }); }
const chrome = {
  storage: { local: area(local), session: area(volatile) }, permissions: { contains: async () => true },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  scripting: { getRegisteredContentScripts: async () => registrations, registerContentScripts: async x => registrations.push(...x), unregisterContentScripts: async () => { registrations.length = 0; }, executeScript: async args => {
    if (!args.func) return [];
    if (!ready || args.target.documentIds?.[0] !== docId) throw new Error('页面已导航');
    return [{ result: await call(args.func.name === 'installInteractionRecorder' ? 'interactions' : 'diagnostics', args.args) }];
  } },
  tabs: { query: async () => [tab], sendMessage: async (id, message) => ready ? call('extension-message', message) : { ok: true }, onCreated: { addListener() {} }, onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }
};
manager = createSessionManager(chrome);
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow || !['http://127.0.0.1:8765', 'http://localhost:8765'].includes(event.origin)) return;
  const data = event.data;
  if (data.fixture === 'ready') { ready = true; docId = data.documentId; tab.url = data.url; }
  if (data.fixture === 'called') { calls.get(data.id)?.(data.result); calls.delete(data.id); }
  if (data.fixture === 'runtime') {
    const sender = { tab: { ...tab }, frameId: 0, documentId: data.documentId, url: data.url };
    const result = data.message.type === 'SESSION_HELLO' ? await manager.hello(data.message, sender) : await manager.append(data.message, sender);
    event.source.postMessage({ fixture: 'response', id: data.id, result }, event.origin);
  }
});
const assert = (condition, reason = '断言失败') => { if (!condition) throw new Error(reason); };
async function until(check) { const deadline = Date.now() + 8000; while (Date.now() < deadline) { const result = await manager.command({ action: 'read', full: true }); if (check(result.diagnostics)) return result.diagnostics; await new Promise(r => setTimeout(r, 30)); } throw new Error('等待日志保存超时'); }
async function test(name, fn) { const li = document.createElement('li'); try { await fn(); li.textContent = `PASS · ${name}`; li.style.color = '#32866b'; } catch (e) { failures++; li.textContent = `FAIL · ${name}：${e.message}`; li.style.color = '#c44960'; } document.getElementById('results').append(li); }
try {
  const started = await manager.command({ action: 'start', windowId: 100 });
  frame.src = tab.url;
  await test('真实文档接入、事件桥接和 IndexedDB 写入', async () => { await until(s => s.pages.length === 1); await call('emit', 1); const s = await until(s => s.counts.errors === 1); assert(s.errors[0].message === 'fixture-error-0'); });
  await test('错误发生后立即跨站导航，旧页最后一条错误仍然保留', async () => {
    frame.contentWindow.postMessage({ fixture: 'call', id: 'navigate', action: 'navigate' }, '*');
    await until(s => s.pages.length === 2); await call('emit', 1);
    const s = await until(s => s.counts.errors === 3);
    assert(s.errors.some(e => e.message === 'last-error-before-navigation'));
    assert(new Set(s.errors.map(e => new URL(e.pageUrl).origin)).size === 2);
  });
  await test('后台控制器重建后，网页继续写入原会话', async () => { manager = createSessionManager(chrome); await call('emit', 1); const s = await until(s => s.counts.errors === 4); assert(s.sessionId === started.sessionId); });
  await test('超过 100 条仅限制预览，完整会话保留全部事件', async () => {
    await call('emit', 130); const full = await until(s => s.counts.errors === 134);
    const preview = await manager.command({ action: 'read' });
    assert(preview.diagnostics.errors.length === 100 && full.errors.length === 134);
    assert((await sessionDB.events(started.sessionId)).filter(e => e.category === 'errors').length === 134);
  });
  await test('同一文档重新接入后，日志 ID 不冲突、不漏存', async () => {
    await call('diagnostics', ['stop']);
    await call('extension-message', { type: 'SESSION_SYNC' });
    await manager.command({ action: 'read' });
    await call('emit', 1); await until(s => s.counts.errors === 135);
  });
  await test('手动停止后恢复页面函数，不再写入新事件', async () => {
    await manager.command({ action: 'stop' }); await call('emit', 1);
    await new Promise(r => setTimeout(r, 150));
    const stopped = await manager.command({ action: 'read', full: true }); assert(!stopped.diagnostics.active && stopped.diagnostics.counts.errors === 135);
  });
} catch (error) { failures++; const li = document.createElement('li'); li.textContent = `FAIL · 初始化：${error.message}`; document.getElementById('results').append(li); }
document.getElementById('progress').textContent = failures ? `${failures} 项失败` : '全部 6 项测试通过；本地测试会话已停止。';
document.title = failures ? `FAIL · ${failures} session browser tests` : 'PASS · 6 continuous session browser tests';
