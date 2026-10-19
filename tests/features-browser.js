import { pageDiagnostics } from '../diagnostics.js';
import { htmlReport } from '../report.js';
let failed = 0;
const assert = (condition, reason = '断言失败') => { if (!condition) throw new Error(reason); };
const test = async (name, fn) => {
  const li = document.createElement('li');
  try { await fn(); li.textContent = `PASS · ${name}`; li.style.color = '#308773'; }
  catch (error) { failed++; li.textContent = `FAIL · ${name}：${error.message}`; li.style.color = '#c84062'; }
  document.getElementById('results').append(li);
};
pageDiagnostics('start');
await test('真实 fetch 404 保留响应对象并采集失败，不记录 query', async () => {
  const response = await fetch('./missing-fetch?token=test-only');
  assert(response.status === 404);
  const log = pageDiagnostics('read').requests.find(r => r.kind === 'fetch');
  assert(log?.status === 404 && !log.url.includes('token'));
});
await test('真实 XHR 404 可正常完成并记录状态', async () => {
  await new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('GET', './missing-xhr'); xhr.onloadend = () => { try { assert(xhr.status === 404); resolve(); } catch (e) { reject(e); } }; xhr.send(); });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(pageDiagnostics('read').requests.some(r => r.kind === 'xhr' && r.status === 404), JSON.stringify(pageDiagnostics('read').requests));
});
await test('真实图片加载错误被主文档捕获', async () => {
  const img = new Image(); document.getElementById('fixtures').append(img);
  await new Promise(resolve => { img.onerror = resolve; img.src = './missing-image.png'; });
  img.remove(); assert(pageDiagnostics('read').requests.some(r => r.kind === 'resource' && r.url.endsWith('missing-image.png')));
});
await test('运行时错误、未处理 Promise 和 console.error 均可记录', async () => {
  window.dispatchEvent(new ErrorEvent('error', { message: 'runtime-test', filename: location.href, lineno: 42, error: new Error('runtime-test') }));
  window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('promise-test') }));
  console.error('console-test', { token: 'private' });
  const snapshot = pageDiagnostics('read');
  for (const kind of ['javascript', 'unhandledrejection', 'console.error']) assert(snapshot.errors.some(e => e.kind === kind), kind);
  assert(!JSON.stringify(snapshot).includes('private'));
});
await test('停止后恢复原生函数，清空后没有旧记录', () => {
  pageDiagnostics('stop'); assert(!pageDiagnostics('read').active);
  const count = pageDiagnostics('read').errors.length; console.error('after-stop-test'); assert(pageDiagnostics('read').errors.length === count);
  pageDiagnostics('clear'); assert(pageDiagnostics('read').errors.length === 0);
});
await test('真正的模块 Worker 返回像素差异与区域', async () => {
  const worker = new Worker(new URL('../diff-worker.js', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data); worker.onerror = reject;
      worker.postMessage({ before: new Uint8ClampedArray([0,0,0,255,0,0,0,255]), after: new Uint8ClampedArray([255,0,0,255,0,0,0,255]), width: 2, height: 1, threshold: 24 });
    });
    assert(result.ok && result.percentage === 50 && result.bounds.width === 1);
  } finally { worker.terminate(); }
});
await test('离线 HTML 正确转义脚本与事件属性，内嵌截图可显示', () => {
  const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
  const html = htmlReport({ title: '</title><script>bad()</script>', id: 'test', createdAt: new Date().toISOString(), steps: '<img src=x onerror=bad()>', severity: 'high' }, canvas.toDataURL());
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  assert(parsed.querySelectorAll('script').length === 0 && parsed.querySelectorAll('[onerror]').length === 0);
  assert(parsed.querySelector('img').src.startsWith('data:image/png')); assert(parsed.querySelector('meta[http-equiv]').content.includes("default-src 'none'"));
});
document.title = failed ? `FAIL · ${failed} BugSnap v1.1 browser tests` : 'PASS · 7 BugSnap v1.1 browser tests';
