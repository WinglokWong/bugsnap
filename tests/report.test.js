import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, zip, normalizedRect, canvasPoint, paint } from '../report.js';
const report = { id: 'test-id', title: '<script> **登录**', createdAt: '2026-09-22', severity: 'high', description: '<img src=x onerror=alert(1)>', steps: '1. 输入信息\n\n2. 点击登录', expected: '进入首页', actual: '没有响应', capture: { screenshot: 'data:image/png;base64,AA==', page: { title: '登录', url: 'https://example.com/?q=`test`', capturedAt: '2026-09-22', browser: 'Chrome 153', platform: 'Mac', screen: { width: 1440, height: 900 }, window: { width: 1400, height: 860 }, viewport: { width: 1000, height: 800 }, devicePixelRatio: 2 }, element: { selector: 'button.login', tag: 'button', text: '登录', attributes: { type: 'button' } } } };
test('Markdown retains structured context, escapes HTML and renumbers steps', () => {
  const md = markdown(report, 'screenshot.png');
  assert.ok(md.includes('\\<script\\>')); assert.ok(md.includes('\\<img')); assert.ok(!/(?<!\\)<img/.test(md));
  assert.ok(md.includes('严重程度：高')); assert.ok(md.includes('1000 × 800'));
  assert.ok(md.includes('1. 输入信息\n2. 点击登录')); assert.ok(md.includes('![问题截图](screenshot.png)'));
  assert.ok(md.includes('button.login')); assert.ok(md.includes('ˋtestˋ'));
});
test('Text-only reports and copied reports have useful fallbacks', () => {
  assert.ok(markdown({ ...report, capture: null, steps: '' }).includes('页面：未采集'));
  assert.ok(markdown(report).includes('作为附件上传')); assert.ok(!markdown(report).includes('data:image'));
});
test('Canvas coordinates honor CSS resizing, DPR and reverse drags', () => {
  const p = canvasPoint({ clientX: 175, clientY: 100 }, { left: 50, top: 25, width: 250, height: 150 }, 1000, 600);
  assert.deepEqual(p, { x: 500, y: 300 });
  assert.deepEqual(normalizedRect({ x: 500, y: 300 }, { x: 200, y: 100 }), { x: 200, y: 100, width: 300, height: 200 });
  assert.deepEqual(canvasPoint({ clientX: -1, clientY: 999 }, { left: 0, top: 0, width: 100, height: 100 }, 500, 500), { x: 0, y: 500 });
});
test('ZIP contains valid UTF-8 entries, central directory and independently verified CRC', async () => {
  const data = new Uint8Array(await zip([{ name: 'report.md', data: '你好 BugSnap' }, { name: 'screenshot.png', data: new Uint8Array([1, 2, 3]) }]).arrayBuffer());
  const view = new DataView(data.buffer); assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x800);
  const size = view.getUint32(18, true), start = 30 + view.getUint16(26, true);
  assert.equal(new TextDecoder().decode(data.slice(start, start + size)), '你好 BugSnap');
  const end = data.length - 22; assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
  assert.equal(view.getUint32(view.getUint32(end + 16, true), true), 0x02014b50);
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(`${tmpdir()}/bugsnap-test-`);
  try { await writeFile(`${dir}/test.zip`, data); assert.match(execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("report.md").decode()=="你好 BugSnap"; print("ok")', `${dir}/test.zip`], { encoding: 'utf8' }), /ok/); } finally { await rm(dir, { recursive: true }); }
});
test('Rendering uses the same annotations for preview and export', () => {
  const calls = []; const ctx = { canvas: { width: 1200, height: 750 }, clearRect: (...a) => calls.push(['clear', ...a]), drawImage: () => calls.push(['image']), strokeRect: (...a) => calls.push(['rect', ...a]), measureText: () => ({ width: 30 }), fillRect: () => {}, fillText: text => calls.push(['text', text]) };
  paint(ctx, {}, [{ type: 'rect', x: 10, y: 20, width: 30, height: 40, color: 'red' }, { type: 'text', x: 15, y: 25, text: '问题', color: 'red' }]);
  assert.deepEqual(calls[2], ['rect', 10, 20, 30, 40]); assert.deepEqual(calls[3], ['text', '问题']);
});

test('Offline HTML escapes hostile fields and never loads remote or SVG images', async () => {
  const { htmlReport } = await import('../report.js');
  const html = htmlReport({ ...report, title: '</title><script>alert(1)</script>', description: '<img onerror=alert(1)>' }, 'https://evil.test/tracker.png');
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('src="https://evil'));
  assert.ok(html.includes("default-src 'none'"));
});
test('Diagnostics inclusion preference applies to every export without mutating stored evidence', async () => {
  const { htmlReport, exportReport } = await import('../report.js');
  const input = { ...report, includeDiagnostics: false, capture: { ...report.capture, diagnostics: { errors: [{ message: 'secret-evidence' }] } } };
  assert.ok(!JSON.stringify(exportReport(input)).includes('secret-evidence')); assert.ok(!markdown(input).includes('secret-evidence')); assert.ok(!htmlReport(input).includes('secret-evidence'));
  assert.equal(input.capture.diagnostics.errors[0].message, 'secret-evidence');
});
test('Arrow rendering includes direction and an arrowhead', () => {
  const calls = []; const ctx = { canvas: { width: 1000, height: 500 }, clearRect() {}, drawImage() {}, beginPath() {}, moveTo: (...a) => calls.push(['move', ...a]), lineTo: (...a) => calls.push(['line', ...a]), stroke() {}, closePath() {}, fill: () => calls.push(['fill']) };
  paint(ctx, {}, [{ type: 'arrow', x: 100, y: 50, endX: 10, endY: 50, color: 'red' }]);
  assert.deepEqual(calls[1], ['line', 10, 50]); assert.equal(calls.at(-1)[0], 'fill'); assert.equal(calls.filter(c => c[0] === 'line').length, 3);
});

test('Portable reports include comparison evidence and diagnostic coverage', async () => {
  const { htmlReport } = await import('../report.js');
  const png = 'data:image/png;base64,AA==';
  const expanded = { ...report, capture: { ...report.capture, diagnostics: { startedAt: 'now', stoppedAt: null, coverage: '测试覆盖范围', dropped: { errors: 1, requests: 2 }, errors: [{ time: 'now', kind: 'javascript', message: '<script>bad</script>', source: '/app.js', line: 2, column: 3, stack: 'stack' }], requests: [{ time: 'now', kind: 'fetch', method: 'GET', url: '/api', status: 500, error: 'HTTP 500' }] } }, comparison: { before: { title: '修复前', id: 'a', image: png }, after: { title: '修复后', id: 'b', image: png }, percentage: 25, changed: 1, total: 4, width: 2, height: 2, originalWidth: 4, originalHeight: 4, scale: .5, threshold: 24, diffImage: png } };
  const md = markdown(expanded, 'screenshot.png', true), html = htmlReport(expanded, png);
  assert.ok(md.includes('comparison-before.png') && md.includes('comparison-after.png') && md.includes('comparison-diff.png'));
  assert.ok(md.includes('25.000%') && md.includes('测试覆盖范围') && md.includes('HTTP 500'));
  assert.equal((html.match(/<img /g) || []).length, 4); assert.ok(!html.includes('<script>bad'));
  assert.ok(html.includes('25.000%') && html.includes('&lt;script&gt;bad'));
});
