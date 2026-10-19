import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRecordedEvent } from '../event-schema.js';
import { recordingFiles } from '../recording-report.js';
test('Action schema never retains values, form bodies or arbitrary attributes', () => {
  const event = sanitizeRecordedEvent({ kind: 'input', label: '邮箱', state: '已填写', value: 'private-value', body: 'private-body', attributes: { secret: 'private-secret' }, message: '填写了邮箱' }, 'actions');
  assert.equal(event.state, '已填写'); assert.ok(!JSON.stringify(event).includes('private'));
});
test('Sensitive fields and common identifiers are masked', () => {
  const event = sanitizeRecordedEvent({ label: '敏感字段', message: 'password: private', selector: '#password', state: 'secret' }, 'actions');
  assert.equal(event.selector, ''); assert.equal(event.state, undefined); assert.ok(!event.message.includes('private'));
  assert.ok(!sanitizeRecordedEvent({ message: '联系 demo@example.com 13800138000 token=abcdef' }, 'feedback').message.includes('abcdef'));
});
test('Simple package contains a readable timeline, structured data and screenshot files', () => {
  const image = 'data:image/jpeg;base64,AA==';
  const files = recordingFiles({ sessionId: 'abc', startedAt: new Date().toISOString(), note: '<script>bad()</script>', pages: [], counts: { actions: 1, markers: 1 }, timeline: [{ id: '1', category: 'actions', kind: 'click', message: '点击保存', time: new Date().toISOString() }, { id: '2', category: 'feedback', message: '保存失败', image }, { id: '3', category: 'evidence', image }] });
  assert.equal(files.filter(f => f.name.startsWith('screenshots/')).length, 1);
  const html = files.find(f => f.name === '记录.html').data, json = files.find(f => f.name === '记录.json').data;
  assert.ok(html.includes('点击保存') && html.includes('保存失败')); assert.ok(!html.includes('<script>'));
  assert.ok(json.includes('imageFile')); assert.ok(!json.includes('data:image'));
});
test('Export never pretends a partial preview is a complete recording', () => {
  assert.throws(() => recordingFiles({ previewOnly: true }), /完整记录/);
});
