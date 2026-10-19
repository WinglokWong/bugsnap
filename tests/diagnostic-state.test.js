import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticAttachment, diagnosticSummary, shortPage } from '../diagnostic-state.js';
const capture = { tabId: 7, page: { url: 'https://www.baidu.com/', documentId: 'home-doc' } };
const monitoring = { tabId: 7, pageUrl: 'https://www.baidu.com/', diagnostics: { active: false, documentId: 'home-doc', errors: [], requests: [] } };
test('Stopped empty snapshots can attach locally without accessing the active tab', () => {
  const result = diagnosticAttachment(capture, monitoring);
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.errors, []);
  assert.notEqual(result.snapshot, monitoring.diagnostics);
  result.snapshot.errors.push({ message: 'new' }); assert.equal(monitoring.diagnostics.errors.length, 0);
});
test('Search-page logs must not attach to the homepage report', () => {
  const result = diagnosticAttachment(capture, { ...monitoring, pageUrl: 'https://www.baidu.com/s?q=test' });
  assert.equal(result.ok, false); assert.match(result.reason, /日志页面.*baidu.com\/s.*截图页面/);
  assert.ok(!result.reason.includes('q=test'));
});
test('A reload on the same URL, another tab and missing collection are explained', () => {
  assert.match(diagnosticAttachment(capture, { ...monitoring, diagnostics: { ...monitoring.diagnostics, documentId: 'reloaded' } }).reason, /同一次加载/);
  assert.match(diagnosticAttachment(capture, { ...monitoring, tabId: 8 }).reason, /不同标签页/);
  assert.match(diagnosticAttachment(null, monitoring).reason, /先.*采集截图/);
  assert.match(diagnosticAttachment(capture, null).reason, /开始记录/);
});
test('Zero errors is not presented as a healthy page, and cached state is explicit', () => {
  assert.match(diagnosticSummary(monitoring.diagnostics), /不代表页面没有问题/);
  assert.match(diagnosticSummary({ ...monitoring.diagnostics, active: true }, true), /上次读取的快照/);
  assert.equal(shortPage('https://e.test/search?q=private#fragment'), 'https://e.test/search');
});
