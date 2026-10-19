// Test-only adapter: uses the production markup and UI with disposable in-memory records.
import { setupEasyUI } from '../easy-ui.js';
import { UI_VERSION } from '../runtime-compat.js';
const source = await (await fetch('../sidepanel.html')).text();
const parsed = new DOMParser().parseFromString(source, 'text/html');
parsed.querySelectorAll('script').forEach(script => script.remove());
parsed.querySelector('.brand').href = '../sidepanel.html';
parsed.querySelector('.brand img').src = '../icons/48.png';
document.body.replaceChildren(...parsed.body.childNodes);
const $ = id => document.getElementById(id);
$('demo-banner').hidden = false;
$('demo-banner').textContent = '界面测试 · 以下 31 条均为可丢弃的模拟记录，不是用户数据';
const records = Array.from({ length: 31 }, (_, i) => ({
  id: `synthetic-history-${i}`, sessionId: `synthetic-history-${i}`, active: false,
  startedAt: new Date(2026, 9, 19 - Math.floor(i / 3), 16, 30 - i % 3).toISOString(),
  stoppedAt: new Date(2026, 9, 19 - Math.floor(i / 3), 16, 35 - i % 3).toISOString(),
  counts: { actions: 2, feedback: 1, markers: 1 }, timeline: [], pages: [], recordingVersion: 2, previewOnly: false, scope: 'test-session', status: 'stopped'
}));
let current = null;
window.chrome = { runtime: { getManifest: () => ({ version: UI_VERSION, optional_host_permissions: ['<all_urls>'] }) }, storage: { onChanged: { addListener() {} } }, permissions: { request: async () => true } };
const ui = setupEasyUI({ extension: true, getWindowId: () => 1,
  command: async (_, args) => {
    if (args.action === 'list') return { sessions: records };
    if (args.action === 'read') return { diagnostics: args.sessionId ? records.find(r => r.id === args.sessionId) : current };
    if (args.action === 'delete') {
      const index = records.findIndex(r => r.id === args.sessionId);
      if (index < 0) throw new Error('记录已不存在。');
      records.splice(index, 1); return { deleted: true };
    }
    throw new Error('此预览仅测试历史管理。');
  },
  download() { $('history-feedback').textContent = '模拟下载成功。'; },
  confirmDelete: item => {
    const dialog = $('delete-dialog'); dialog.returnValue = '';
    $('delete-record-time').textContent = new Date(item.startedAt).toLocaleString('zh-CN');
    return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true }); dialog.showModal(); });
  },
  onRuntimeError: error => { $('runtime-notice').hidden = false; $('runtime-message').textContent = error.message; }
});
await ui.refresh(); ui.setReady(true);
$('easy-history').click();
