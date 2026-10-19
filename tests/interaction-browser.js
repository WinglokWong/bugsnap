import { pageDiagnostics } from '../diagnostics.js';
import { installInteractionRecorder } from '../interaction-recorder.js';
const $ = id => document.getElementById(id), assert = (yes, message = '断言失败') => { if (!yes) throw new Error(message); };
let failures = 0;
const test = async (name, fn) => { const li = document.createElement('li'); try { await fn(); li.textContent = `PASS · ${name}`; li.style.color = '#2d856b'; } catch (error) { failures++; li.textContent = `FAIL · ${name}：${error.message}`; li.style.color = '#c14b61'; } $('results').append(li); };
const input = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const snapshot = () => pageDiagnostics('read');
$('form').addEventListener('submit', e => e.preventDefault());
const originalConfirm = window.confirm; window.confirm = () => false;
const mockConfirm = window.confirm;
pageDiagnostics('start', { sessionId: 'browser-interactions', eventName: 'bugsnap-stream-interaction-tests' });
installInteractionRecorder({ recordSynthetic: true });
await test('点击按钮会自动留下可读操作记录', () => { $('save').click(); assert(snapshot().actions.some(e => e.kind === 'click' && e.message.includes('保存'))); });
await test('普通输入、密码和 contenteditable 不会输出原文', () => {
  input($('name'), 'PRIVATE_NAME_VALUE'); input($('password'), 'PRIVATE_PASSWORD_VALUE'); input($('message'), 'PRIVATE_NOTE_VALUE');
  $('editable').textContent = 'PRIVATE_EDITABLE_VALUE'; $('editable').dispatchEvent(new Event('input', { bubbles: true })); $('editable').dispatchEvent(new Event('change', { bubbles: true }));
  const log = JSON.stringify(snapshot()); for (const secret of ['PRIVATE_NAME_VALUE', 'PRIVATE_PASSWORD_VALUE', 'PRIVATE_NOTE_VALUE', 'PRIVATE_EDITABLE_VALUE']) assert(!log.includes(secret), secret);
  assert(snapshot().actions.some(e => e.state === '已填写'));
});
await test('复选框、下拉选择、表单提交被自动记录', () => {
  $('checkbox').checked = true; $('checkbox').dispatchEvent(new Event('change', { bubbles: true }));
  $('choice').selectedIndex = 1; $('choice').dispatchEvent(new Event('change', { bubbles: true }));
  $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert(snapshot().actions.some(e => e.state === '已选中')); assert(snapshot().actions.some(e => e.state === '选项序号 2')); assert(snapshot().actions.some(e => e.kind === 'submit'));
});
await test('HTTP 200 的业务失败也能通过页面提示留下证据', async () => {
  const response = await fetch('./business-result.json'); const data = await response.json();
  $('feedback').hidden = false; $('feedback').textContent = `${data.message} PRIVATE_PASSWORD_VALUE`;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert(snapshot().network.some(e => e.status === 200)); assert(snapshot().feedback.some(e => e.message.includes('保存失败')));
  assert(!JSON.stringify(snapshot()).includes('PRIVATE_PASSWORD_VALUE')); assert(!JSON.stringify(snapshot()).includes('RESPONSE_BODY_NOT_FOR_LOGS'));
});
await test('原生确认框保留原返回值，记录显示与取消反馈', () => {
  assert(window.confirm('确认保存吗？') === false);
  assert(snapshot().feedback.some(e => e.kind === 'dialog')); assert(snapshot().feedback.some(e => e.message.includes('取消')));
});
await test('SPA 路由变化可记录，URL 查询内容被隐藏', () => {
  const routePath = `#/results-${Date.now()}`; history.pushState({}, '', `${routePath}?token=PRIVATE_ROUTE_TOKEN`);
  assert(snapshot().navigation.some(e => e.destination?.endsWith(routePath)));
  assert(!JSON.stringify(snapshot()).includes('PRIVATE_ROUTE_TOKEN'));
});
await test('结束时收齐尚未提交的输入状态，之后不再记录操作', () => {
  $('name').value = 'FINAL_PRIVATE_VALUE'; $('name').dispatchEvent(new Event('input', { bubbles: true }));
  const before = snapshot().actions.length; pageDiagnostics('stop');
  assert(snapshot().actions.length === before + 1); const after = snapshot().actions.length;
  $('save').click(); assert(snapshot().actions.length === after); assert(window.confirm === mockConfirm);
  assert(!JSON.stringify(snapshot()).includes('FINAL_PRIVATE_VALUE'));
});
window.confirm = originalConfirm;
document.title = failures ? `FAIL · ${failures} interaction browser tests` : 'PASS · 7 user-recording browser tests';

await test('程序触发的点击不会误记为用户操作', () => {
  pageDiagnostics('start', { sessionId: 'trusted-test', eventName: 'bugsnap-stream-trusted-test' });
  installInteractionRecorder(); $('save').click(); assert(snapshot().actions.length === 0);
});
const trustedStatus = document.createElement('p'); trustedStatus.id = 'trusted-status'; trustedStatus.textContent = '等待通过浏览器点击“保存”，验证真实操作。'; document.body.append(trustedStatus);
window.addEventListener('bugsnap-stream-trusted-test', event => {
  const data = JSON.parse(event.detail);
  if (data.category === 'actions' && data.entry.kind === 'click' && data.entry.label === '保存') {
    trustedStatus.textContent = 'PASS · 已捕获真实浏览器点击，生产模式操作采集正常。';
    pageDiagnostics('stop');
    document.title = failures ? `FAIL · ${failures} interaction browser tests` : 'PASS · 9 user-recording browser checks';
  }
});
document.title = failures ? `FAIL · ${failures} interaction browser tests` : 'PASS · 8 user-recording browser tests';
