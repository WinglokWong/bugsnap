import { store } from './store.js';
import { markdown, htmlReport, exportReport, severityNames, normalizedRect, canvasPoint, paint, zip } from './report.js';
import { groupByPage, pageKey } from './compare.js';
import { setupEasyUI } from './easy-ui.js';
import { setupComparison } from './comparison-ui.js';
import { diagnosticAttachment, diagnosticSummary, shortPage } from './diagnostic-state.js';
const $ = id => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id);
const fields = ['title', 'description', 'steps', 'expected', 'actual'];
let windowId = 'preview', draft, image, tool = 'rect', drawing, busy = false, toastTimer, draftTimer, pendingDelete, monitoring = null, diagnosticsBusy = false, sessionRefreshTimer;
const fresh = () => ({ schemaVersion: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: '', description: '', steps: '', expected: '', actual: '', severity: 'medium', capture: null, annotations: [], requestId: null, includeDiagnostics: true, comparison: null });
const notify = (message, error = false) => {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => $('toast').hidden = true, error ? 9000 : 4000);
};
function friendly(error) {
  const msg = error?.message || String(error);
  if (/Cannot access|Missing host permission|cannot be scripted|Extension manifest must request/i.test(msg)) return '请在目标网页点击一次 Chrome 工具栏中的 BugSnap 图标授权，然后重试。本地文件还需开启「允许访问文件网址」。';
  if (/Either.*activeTab|all_urls.*permission/i.test(msg)) return '日志会话仍在持续记录。当前标签页截图还需要临时权限，请点击顶部 BugSnap 图标后重新截图，无需重新开始会话。';
  if (/quota/i.test(msg)) return '本地存储空间不足，请先导出并删除部分历史记录，再重试。';
  return msg;
}
function confirmAction(message) {
  const dialog = $('confirm-dialog'); $('confirm-message').textContent = message;
  dialog.returnValue = '';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}
function action(id, fn) { $(id).addEventListener('click', async () => { try { await fn(); } catch (error) { notify(friendly(error), true); } }); }
function touch() {
  draft.updatedAt = new Date().toISOString();
  clearTimeout(draftTimer); $('draft-status').textContent = '正在保存草稿…';
  draftTimer = setTimeout(() => persist().catch(error => notify(friendly(error), true)), 300);
}
async function persist() {
  clearTimeout(draftTimer);
  await store('drafts', 'put', structuredClone(draft), String(windowId));
  $('draft-status').textContent = '草稿已自动保存';
}
function setBusy(value) {
  busy = value;
  for (const id of ['pick', 'capture', 'save', 'new-report', 'diagnostics-start', 'diagnostics-refresh', 'diagnostics-attach']) $(id).disabled = value;
  $('cancel-pick').hidden = !value || !draft.requestId;
  updateDiagnosticButtons();
}
function renderSeverity() {
  document.querySelectorAll('[data-severity]').forEach(button => {
    const selected = button.dataset.severity === draft.severity;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
  });
}
async function renderCapture() {
  const c = draft.capture;
  $('page-info').hidden = !c; $('capture-empty').hidden = !!c; $('screenshot-card').hidden = !c?.screenshot;
  $('capture-state').textContent = c ? '已采集' : '待采集'; $('capture-state').classList.toggle('ready', !!c);
  if (!c) { image = null; return; }
  $('page-title').textContent = c.page.title || '无标题页面'; $('page-url').textContent = c.page.url;
  $('page-url').title = c.page.url;
  $('viewport').textContent = `${c.page.viewport.width} × ${c.page.viewport.height}`;
  $('browser').textContent = c.page.browser.match(/(?:Chrome|Edg)\/[\d.]+/)?.[0].replace('/', ' ') || c.page.browser;
  $('selector').hidden = !c.element; $('selector').textContent = c.element?.selector || '';
  $('metadata').textContent = JSON.stringify({ page: c.page, element: c.element }, null, 2);
  if (c.screenshot) {
    const loaded = new Image(); loaded.src = c.screenshot; await loaded.decode();
    if (draft.capture !== c) return;
    image = loaded; $('canvas').width = loaded.naturalWidth; $('canvas').height = loaded.naturalHeight;
    $('image-size').textContent = `${loaded.naturalWidth} × ${loaded.naturalHeight} px`;
    draw();
  }
}
function draw(extra) {
  if (!image) return;
  paint($('canvas').getContext('2d'), image, extra ? [...draft.annotations, extra] : draft.annotations);
  $('undo').disabled = !draft.annotations.length;
}
async function render() {
  diagnosticFeedback('');
  fields.forEach(id => $(id).value = draft[id]); $('include-diagnostics').checked = draft.includeDiagnostics !== false; renderSeverity(); await renderCapture(); renderDiagnostics(); renderComparisonAttachment();
}
async function command(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, windowId, ...extra });
  if (!result?.ok) throw new Error(result?.error || '无法连接采集服务，请重新加载扩展。');
  return result;
}
async function consume(result) {
  if (!result || result.requestId !== draft.requestId) return;
  draft.requestId = null; setBusy(false);
  if (result.error) { touch(); throw new Error(result.error); }
  if (result.cancelled) { touch(); notify('已取消元素选择'); return; }
  if (extension && result.diagnostics?.scope === 'test-session') {
    const full = await command('DIAGNOSTICS', { action: 'read', sessionId: result.diagnostics.sessionId, full: true });
    result.diagnostics = full.diagnostics;
  }
  draft.capture = { page: result.page, element: result.element, screenshot: result.screenshot, tabId: result.tabId, diagnostics: result.diagnostics ? structuredClone(result.diagnostics) : null };
  draft.annotations = []; draft.comparison = null;
  if (result.diagnostics) {
    monitoring = { tabId: result.tabId, pageUrl: result.page.url, diagnostics: structuredClone(result.diagnostics), readAt: new Date().toISOString(), cached: false };
    await persistMonitoring();
  }
  diagnosticFeedback(result.diagnostics ? '采集成功，当前页面的运行日志已自动附加。' : '当前截图没有运行日志。需要日志时，请先开始记录并复现问题，再刷新日志、附加。');
  await renderCapture(); renderDiagnostics(); renderComparisonAttachment(); await persist(); notify('现场已采集，可以标注截图了');
}
async function capture(pick) {
  if (busy) return;
  if (draft.capture && !(await confirmAction('重新采集会替换当前截图与标注，已填写的文字会保留。继续吗？'))) return;
  draft.requestId = crypto.randomUUID(); setBusy(true);
  try {
    await persist();
    if (!extension) { await consume(await demoCapture(draft.requestId)); return; }
    const result = await command(pick ? 'PICK' : 'CAPTURE', { requestId: draft.requestId });
    if (result.result) await consume(result.result);
    else notify('请在网页中点击问题元素，按 Esc 可取消');
  } catch (error) { draft.requestId = null; setBusy(false); touch(); throw error; }
}
async function cancelPick() {
  if (extension) await command('CANCEL');
  draft.requestId = null; setBusy(false); await persist();
}
function validated() {
  fields.forEach(id => draft[id] = $(id).value);
  if (!draft.title.trim()) { showTab('edit'); $('title').focus(); throw new Error('请先填写问题标题。'); }
  return { ...structuredClone(draft), schemaVersion: 2, title: draft.title.trim(), updatedAt: new Date().toISOString(), requestId: undefined };
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function screenshotBlob() {
  if (!image) throw new Error('请先采集截图。');
  draw(); return new Promise((resolve, reject) => $('canvas').toBlob(blob => blob ? resolve(blob) : reject(new Error('截图导出失败')), 'image/png'));
}
function showTab(name) {
  $('editor').hidden = name !== 'edit'; $('history').hidden = name !== 'history';
  for (const tab of ['edit', 'history', 'compare']) { $(`tab-${tab}`).classList.toggle('active', tab === name); $(`tab-${tab}`).setAttribute('aria-selected', String(tab === name)); }
  $('compare').hidden = name !== 'compare'; $('save').hidden = name !== 'edit';
}
async function renderHistory() {
  const reports = (await store('reports', 'getAll')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('history-count').textContent = reports.length;
  const query = $('search').value.trim().toLowerCase();
  const filtered = reports.filter(r => `${r.title} ${r.capture?.page.url || ''}`.toLowerCase().includes(query) && (!$('history-severity').value || r.severity === $('history-severity').value));
  $('history-list').replaceChildren(); $('history-empty').hidden = filtered.length > 0;
  $('history-empty').querySelector('h2').textContent = query ? '没有找到匹配的报告' : '每一次反馈，都有迹可循';
  const destinations = new Map();
  if ($('group-pages').checked) for (const group of groupByPage(filtered)) {
    const section = document.createElement('section'); section.className = 'page-group';
    const heading = document.createElement('h2'), title = document.createElement('span'), count = document.createElement('b');
    title.textContent = group.url; count.textContent = group.reports.length; heading.append(title, count); section.append(heading);
    $('history-list').append(section); destinations.set(group.url, section);
  }
  for (const report of filtered) {
    const row = document.createElement('article'); row.className = 'history-item';
    if (report.capture?.screenshot) { const img = document.createElement('img'); img.src = report.capture.screenshot; img.alt = '问题截图缩略图'; row.append(img); }
    const content = document.createElement('div'); content.className = 'content';
    const heading = document.createElement('h2'); heading.textContent = report.title;
    const meta = document.createElement('p'); meta.textContent = `${severityNames[report.severity]} · ${new Date(report.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    const open = document.createElement('button'); open.textContent = '查看 / 编辑';
    open.addEventListener('click', async () => { try {
      if (busy) { notify('请先完成或取消元素选择'); return; }
      if (draft.id !== report.id && (draft.title || draft.capture) && !(await confirmAction('打开历史报告会替换当前草稿，请先保存需要保留的内容。继续吗？'))) return;
      clearTimeout(draftTimer); draft = structuredClone(report); draft.requestId = null; await render(); await persist(); showTab('edit'); window.scrollTo(0, 0);
    } catch (error) { notify(friendly(error), true); } });
    const remove = document.createElement('button'); remove.className = 'delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `删除 ${report.title}`);
    remove.addEventListener('click', () => { pendingDelete = report.id; $('delete-dialog').showModal(); });
    content.append(heading, meta, open); row.append(content, remove); (destinations.get(pageKey(report.capture?.page.url)) || $('history-list')).append(row);
  }
}
fields.forEach(id => $(id).addEventListener('input', () => { draft[id] = $(id).value; touch(); }));
document.querySelectorAll('[data-severity]').forEach(button => button.addEventListener('click', () => { draft.severity = button.dataset.severity; renderSeverity(); touch(); }));
$('report-form').addEventListener('submit', e => e.preventDefault());
action('pick', () => capture(true)); action('capture', () => capture(false)); action('cancel-pick', cancelPick);
action('save', async () => { const report = validated(); await store('reports', 'put', report); draft.updatedAt = report.updatedAt; await persist(); await renderHistory(); notify('报告已保存到本地历史记录'); });
action('copy', async () => { await navigator.clipboard.writeText(markdown(validated())); notify('Markdown 报告已复制，截图请单独下载附上'); });
action('export-md', async () => {
  const report = exportReport(validated()), files = [{ name: 'report.md', data: markdown(report, image ? 'screenshot.png' : '', true) }];
  if (report.comparison) for (const [name, uri] of [['comparison-before.png', report.comparison.before.image], ['comparison-after.png', report.comparison.after.image], ['comparison-diff.png', report.comparison.diffImage]]) files.push({ name, data: dataBytes(uri) });
  if (image) files.push({ name: 'screenshot.png', data: new Uint8Array(await (await screenshotBlob()).arrayBuffer()) });
  download(zip(files), `BugSnap-${report.id.slice(0, 8)}.zip`); notify('Markdown 报告包已导出');
});
action('export-json', () => {
  const report = exportReport(validated());
  if (image) { draw(); report.annotatedScreenshot = $('canvas').toDataURL('image/png'); }
  download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `BugSnap-${report.id.slice(0, 8)}.json`); notify('JSON 报告已导出');
});
action('export-html', () => {
  const report = validated(); if (image) draw();
  download(new Blob([htmlReport(report, image ? $('canvas').toDataURL('image/png') : '')], { type: 'text/html;charset=utf-8' }), `BugSnap-${report.id.slice(0, 8)}.html`);
  notify('HTML 报告已导出，可离线打开');
});
action('download-image', async () => download(await screenshotBlob(), `BugSnap-${draft.id.slice(0, 8)}.png`));
action('preview', () => { $('preview-content').textContent = markdown(validated()); $('preview-dialog').showModal(); });
action('close-preview', () => $('preview-dialog').close());
action('tab-compare', async () => { await comparisonUI.refresh(); showTab('compare'); });
action('tab-edit', () => showTab('edit')); action('tab-history', async () => { await renderHistory(); showTab('history'); });
action('new-report', async () => {
  if ((draft.title || draft.capture) && !(await confirmAction('新建反馈会替换当前草稿，请先保存需要保留的内容。继续吗？'))) return;
  clearTimeout(draftTimer); draft = fresh(); await render(); await persist(); showTab('edit'); window.scrollTo(0, 0);
});
action('cancel-delete', () => $('delete-dialog').close());
action('confirm-delete', async () => {
  await store('reports', 'delete', pendingDelete);
  if (draft.id === pendingDelete) { clearTimeout(draftTimer); draft = fresh(); await render(); await persist(); }
  $('delete-dialog').close(); await renderHistory(); notify('历史报告已删除');
});
$('search').addEventListener('input', () => renderHistory().catch(error => notify(friendly(error), true)));
for (const type of ['rect', 'arrow', 'text']) action(`tool-${type}`, () => {
  tool = type; $('annotation-text').hidden = type !== 'text';
  for (const t of ['rect', 'arrow', 'text']) { $(`tool-${t}`).classList.toggle('active', t === type); $(`tool-${t}`).setAttribute('aria-pressed', String(t === type)); }
  if (type === 'text') $('annotation-text').focus();
});
action('undo', () => { draft.annotations.pop(); draw(); touch(); });
action('expand', () => { const expanded = $('screenshot-card').classList.toggle('expanded'); $('expand').textContent = expanded ? '收起 ✕' : '⤢'; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('screenshot-card').classList.remove('expanded'); $('expand').textContent = '⤢'; } });
const point = e => canvasPoint(e, $('canvas').getBoundingClientRect(), $('canvas').width, $('canvas').height);
$('canvas').addEventListener('pointerdown', e => {
  if (!image || e.button !== 0) return;
  const p = point(e);
  if (tool === 'text') {
    const text = $('annotation-text').value.trim();
    if (!text) { notify('先输入标注文字，再点击截图放置'); $('annotation-text').focus(); return; }
    draft.annotations.push({ type: 'text', ...p, text, color: $('color').value }); draw(); touch(); return;
  }
  drawing = { start: p, end: p, type: tool, color: $('color').value }; $('canvas').setPointerCapture(e.pointerId);
});
$('canvas').addEventListener('pointermove', e => {
  if (!drawing) return;
  drawing.end = point(e); draw(drawingMark(drawing));
});
$('canvas').addEventListener('pointerup', e => {
  if (!drawing) return;
  drawing.end = point(e); const rect = normalizedRect(drawing.start, drawing.end);
  if (drawing.type === 'arrow' ? Math.hypot(rect.width, rect.height) > 4 : rect.width > 4 && rect.height > 4) { draft.annotations.push(drawingMark(drawing)); touch(); }
  drawing = null; draw();
});
$('canvas').addEventListener('pointercancel', () => { drawing = null; draw(); });
async function demoCapture(requestId) {
  let sample = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750"><rect width="1200" height="750" fill="#f5f6fa"/><rect width="1200" height="68" fill="white"/><text x="50" y="43" font-family="sans-serif" font-size="23" fill="#292c42">ACME / Workspace</text><rect x="390" y="130" width="420" height="500" rx="20" fill="white"/><text x="440" y="207" font-family="sans-serif" font-size="28" fill="#292c42">Welcome back</text><text x="440" y="249" font-family="sans-serif" font-size="15" fill="#9498aa">Sign in to your workspace</text><rect x="440" y="295" width="320" height="52" rx="8" fill="#f3f4f8"/><text x="455" y="327" font-family="sans-serif" font-size="15" fill="#a3a7b5">Email address</text><rect x="440" y="370" width="320" height="52" rx="8" fill="#f3f4f8"/><text x="455" y="401" font-family="sans-serif" font-size="15" fill="#a3a7b5">Password</text><rect x="440" y="458" width="320" height="52" rx="8" fill="#7962d9"/><text x="565" y="491" font-family="sans-serif" font-size="18" fill="white">Sign in</text><text x="440" y="567" font-family="sans-serif" font-size="13" fill="#aaa">BugSnap preview sample</text></svg>`;
  if (draft.capture) sample = sample.replace('Sign in</text>', 'Continue</text>').replace('fill="#7962d9"', 'fill="#389b80"');
  const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sample)}`; await img.decode();
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 750; canvas.getContext('2d').drawImage(img, 0, 0);
  return { requestId, diagnostics: monitoring?.diagnostics || null, screenshot: canvas.toDataURL('image/png'), page: { title: '示例登录页面（预览数据）', url: 'https://example.com/login', capturedAt: new Date().toISOString(), browser: navigator.userAgent, platform: navigator.platform, screen: { width: screen.width, height: screen.height }, window: { width: 1440, height: 900 }, viewport: { width: 1200, height: 750 }, devicePixelRatio: 1, scroll: { x: 0, y: 0 } }, element: { selector: 'button.login-submit', tag: 'button', text: 'Sign in', attributes: { class: 'login-submit', type: 'submit' }, rect: { x: 440, y: 458, width: 320, height: 52 } } };
}
async function init() {
  if (extension) windowId = (await chrome.windows.getCurrent()).id;
  else $('demo-banner').hidden = false;
  draft = { ...fresh(), ...((await store('drafts', 'get', String(windowId))) || {}), schemaVersion: 2 };
  monitoring = (await store('drafts', 'get', `diagnostics:${windowId}`)) || null;
  if (monitoring) monitoring.cached = true;
  await render(); await renderHistory();
  if (!extension) await refreshSessionHistory();
  await easyUI.refresh();
  if (extension) {
    await diagnosticAction('read', true);
    await refreshSessionHistory();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.diagnosticSessionStatus?.newValue) {
        const status = changes.diagnosticSessionStatus.newValue;
        if (status.error) diagnosticFeedback(status.error, true);
        if (!monitoring?.sessionId || monitoring.sessionId === status.id) {
          clearTimeout(sessionRefreshTimer); sessionRefreshTimer = setTimeout(() => { if (!diagnosticsBusy) diagnosticAction('read', true).catch(error => diagnosticFeedback(friendly(error), true)); }, 500);
        }
      }
      if (area === 'session' && changes[`capture:${windowId}`]?.newValue) consume(changes[`capture:${windowId}`].newValue).catch(error => notify(friendly(error), true));
    });
    const captureKey = `capture:${windowId}`;
    await consume((await chrome.storage.session.get(captureKey))[captureKey]);
    if (draft.requestId) {
      const pending = (await chrome.storage.session.get(`pick:${windowId}`))[`pick:${windowId}`];
      if (pending?.id === draft.requestId) setBusy(true);
      else { draft.requestId = null; touch(); }
    }
  }
}
const comparisonUI = setupComparison({
  getReports: async () => (await store('reports', 'getAll')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), getDraft: () => draft,
  notify, download, attach: comparison => { draft.comparison = comparison; touch(); renderComparisonAttachment(); notify('截图对比已附加到当前草稿，保存后随报告保留'); }
});
function drawingMark(d) {
  return d.type === 'arrow' ? { type: 'arrow', x: d.start.x, y: d.start.y, endX: d.end.x, endY: d.end.y, color: d.color } : { type: 'rect', ...normalizedRect(d.start, d.end), color: d.color };
}
function dataBytes(uri) { return Uint8Array.from(atob(uri.split(',')[1]), c => c.charCodeAt(0)); }
function renderComparisonAttachment() {
  $('comparison-attached').hidden = !draft.comparison;
  $('comparison-attached-label').textContent = draft.comparison ? `已附加截图对比 · ${draft.comparison.percentage.toFixed(3)}% 像素变化` : '';
}
action('remove-comparison', () => { draft.comparison = null; renderComparisonAttachment(); touch(); });
for (const id of ['group-pages', 'history-severity']) $(id).addEventListener('change', () => renderHistory().catch(error => notify(friendly(error), true)));
function diagnosticFeedback(message, error = false) {
  $('diagnostics-feedback').textContent = message;
  $('diagnostics-feedback').hidden = !message;
  $('diagnostics-feedback').classList.toggle('error', error);
}
function updateDiagnosticButtons() {
  for (const id of ['start', 'refresh', 'stop', 'clear', 'attach', 'join', 'export']) $(`diagnostics-${id}`).disabled = busy || diagnosticsBusy;
  $('diagnostics-stop').disabled ||= !monitoring?.diagnostics?.active;
  $('diagnostics-join').disabled ||= !monitoring?.diagnostics?.active;
  $('diagnostics-export').disabled ||= !monitoring?.diagnostics;
  $('diagnostics-clear').disabled ||= !monitoring?.diagnostics;
  $('diagnostics-attach').textContent = diagnosticsBusy ? '处理中…' : '附加整个会话';
}
async function persistMonitoring() {
  await store('drafts', 'put', structuredClone(monitoring), `diagnostics:${windowId}`);
}
function renderDiagnostics() {
  const attached = draft.capture?.diagnostics, d = monitoring ? monitoring.diagnostics : attached;
  $('diagnostics-state').textContent = monitoring ? (d ? (monitoring.cached ? '已读取快照' : d.active ? ({ recording: '持续记录中', connecting: '正在接入新页', waiting: '会话开启 · 等待页面', permission: '等待授权', 'storage-error': '存储异常' }[d.status] || '持续记录中') : '已停止') : '当前页未开始') : attached ? '已附加快照' : '未开始';
  $('diagnostics-state').classList.toggle('ready', Boolean(monitoring?.diagnostics?.active && !monitoring.cached));
  $('errors-count').textContent = d?.counts?.errors ?? d?.errors.length ?? 0; $('requests-count').textContent = d?.counts?.requests ?? d?.requests.length ?? 0;
  $('diagnostics-summary').textContent = diagnosticSummary(d, monitoring?.cached || (!monitoring && Boolean(attached)));
  $('diagnostics-content').textContent = d ? JSON.stringify(d, null, 2) : '尚未记录。';
  $('diagnostics-target').textContent = d?.scope === 'test-session' ? `会话 ${d.sessionId.slice(0, 8)} · 跟踪 ${d.tabIds.length} 个标签页 · 已接入 ${d.pages.length} 个文档` : monitoring ? `日志页面：${shortPage(monitoring.pageUrl)}${monitoring.readAt ? ` · 读取于 ${new Date(monitoring.readAt).toLocaleTimeString('zh-CN')}` : ''}` : '仅记录主文档的程序错误和失败请求。';
  $('diagnostics-target').title = monitoring?.pageUrl || '';
  $('diagnostics-report-page').textContent = draft.capture ? `报告截图：${shortPage(draft.capture.page.url)}` : '报告截图：尚未采集';
  $('diagnostics-attached').textContent = attached ? `✓ 已附加到草稿：${attached.errors.length} 条错误 / ${attached.requests.length} 条失败请求。保存报告后保留在历史中。${draft.includeDiagnostics === false ? '当前设置：导出时不包含日志。' : '导出时将包含日志。'}` : '尚未附加日志。采集现场会自动附加该页面已记录的日志。';
  $('diagnostics-attached').classList.toggle('attached', Boolean(attached));
  updateDiagnosticButtons();
}
function demoDiagnostics() {
  const time = new Date().toISOString(), sessionId = crypto.randomUUID();
  return { version: 2, scope: 'test-session', sessionId, active: true, status: 'recording', startedAt: time, stoppedAt: null, pageUrl: 'https://example.com/login', documentId: null, tabIds: ['preview'], pages: [{ tabId: 'preview', documentId: 'demo-login', pageDocumentId: 'preview', url: 'https://example.com/login', title: '登录页', time }, { tabId: 'preview', documentId: 'demo-home', pageDocumentId: 'preview-home', url: 'https://example.com/home', title: '首页', time }], counts: { errors: 1, requests: 1, navigation: 2 }, coverage: '预览中的跨页会话示例，不代表当前网页真实记录。', dropped: { errors: 0, requests: 0 }, previewOnly: false,
    errors: [{ time, kind: 'javascript', message: '示例：TypeError: renderDashboard is not a function', pageUrl: 'https://example.com/home', source: 'https://example.com/home.js', line: 42, column: 9, stack: 'at renderDashboard (home.js:42:9)' }],
    requests: [{ time, kind: 'fetch', method: 'POST', url: 'https://example.com/api/login', pageUrl: 'https://example.com/login', status: 500, error: '示例：HTTP 500' }] };
}
async function refreshSessionHistory() {
  if (!extension) {
    $('diagnostics-history').replaceChildren();
    if (monitoring?.diagnostics) { const option = document.createElement('option'); option.textContent = '示例会话（预览模式）'; option.value = monitoring.sessionId || 'preview'; $('diagnostics-history').append(option); }
    return;
  }
  const { sessions } = await command('DIAGNOSTICS', { action: 'list' });
  $('diagnostics-history').replaceChildren();
  for (const s of sessions) {
    const option = document.createElement('option'); option.value = s.id;
    option.textContent = `${s.active ? '● 运行中' : '已停止'} · ${new Date(s.startedAt).toLocaleString('zh-CN')} · ${shortPage(s.startUrl)}`;
    $('diagnostics-history').append(option);
  }
  if (monitoring?.sessionId) $('diagnostics-history').value = monitoring.sessionId;
}
async function diagnosticAction(action, quiet = false) {
  if (extension) {
    // The permission request is called immediately from the start button's user gesture.
    if (action === 'start' || action === 'join') {
      const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
      if (!granted) throw new Error('没有获得网站访问权限，未开启跨页记录。可再次点击开始并选择授权。');
    }
    monitoring = await command('DIAGNOSTICS', { action, ...(['stop', 'clear'].includes(action) ? { sessionId: monitoring?.sessionId } : {}) });
  } else {
    if (action === 'start') { const diagnostics = demoDiagnostics(); monitoring = { tabId: 'preview', sessionId: diagnostics.sessionId, pageUrl: 'https://example.com/login', diagnostics }; }
    if (action === 'stop' && monitoring?.diagnostics) { monitoring.diagnostics.active = false; monitoring.diagnostics.stoppedAt = new Date().toISOString(); }
    if (action === 'clear' && monitoring?.diagnostics) { monitoring.diagnostics.errors = []; monitoring.diagnostics.requests = []; if (monitoring.diagnostics.counts) { monitoring.diagnostics.counts.errors = 0; monitoring.diagnostics.counts.requests = 0; } }
  }
  if (monitoring) { monitoring.readAt = new Date().toISOString(); monitoring.cached = false; }
  renderDiagnostics(); await persistMonitoring();
  if (!quiet) {
    await refreshSessionHistory();
    const messages = {
      start: extension ? '持续会话已开启。当前标签页刷新或跨站跳转后自动续录，新开的子标签页也会加入；其他已有标签页需手动加入。关闭侧边栏不停止记录。' : '已载入示例日志；预览模式不采集真实网页。',
      join: '当前标签页已加入测试会话。',
      read: monitoring?.diagnostics ? '已读取本地保存的会话日志，无需访问当前网页。' : '还没有会话。先在问题网页点击「开始持续记录」。',
      stop: '会话已手动停止。已保存的跨页日志可以继续附加或完整导出。',
      clear: '会话记录已清空，持续记录状态不变。已附加到报告的快照保持不变。'
    };
    diagnosticFeedback(messages[action]);
  }
}
function diagnosticButton(id, fn) {
  $(id).addEventListener('click', async () => {
    if (diagnosticsBusy || busy) return;
    diagnosticsBusy = true; updateDiagnosticButtons(); diagnosticFeedback('正在处理…');
    try { await fn(); }
    catch (error) { const message = friendly(error); diagnosticFeedback(message, true); notify(message, true); }
    finally { diagnosticsBusy = false; renderDiagnostics(); }
  });
}
for (const [id, verb] of [['start', 'start'], ['refresh', 'read'], ['stop', 'stop'], ['clear', 'clear'], ['join', 'join']]) diagnosticButton(`diagnostics-${id}`, () => diagnosticAction(verb));
diagnosticButton('diagnostics-attach', async () => {
  if (extension && monitoring?.sessionId) {
    monitoring = await command('DIAGNOSTICS', { action: 'read', sessionId: monitoring.sessionId, full: true });
    monitoring.readAt = new Date().toISOString();
  }
  const result = diagnosticAttachment(draft.capture, monitoring, extension);
  if (!result.ok) throw new Error(result.reason);
  draft.capture.diagnostics = result.snapshot;
  draft.updatedAt = new Date().toISOString(); await persist();
  const message = `✓ 已附加到当前草稿：${result.snapshot.errors.length} 条错误 / ${result.snapshot.requests.length} 条失败请求。${result.snapshot.active ? '包含本次附加时已保存的记录。会话仍在继续，结束后可再次附加更新报告。' : ''}请点击「保存报告」更新历史，或直接导出。`;
  diagnosticFeedback(message); notify('日志已附加，详情见运行诊断卡片');
});
$('include-diagnostics').addEventListener('change', () => { draft.includeDiagnostics = $('include-diagnostics').checked; renderDiagnostics(); touch(); });
diagnosticButton('diagnostics-export', async () => {
  const data = extension && monitoring?.sessionId ? await command('DIAGNOSTICS', { action: 'read', sessionId: monitoring.sessionId, full: true }) : monitoring;
  if (!data?.diagnostics) throw new Error('还没有可导出的日志。');
  download(new Blob([JSON.stringify(data.diagnostics, null, 2)], { type: 'application/json' }), `BugSnap-session-${(data.sessionId || 'preview').slice(0, 8)}.json`);
  diagnosticFeedback('完整会话已导出，包含所有已保存的错误和失败请求。');
});
$('diagnostics-history').addEventListener('change', async () => {
  if (!extension || !$('diagnostics-history').value) return;
  try {
    monitoring = await command('DIAGNOSTICS', { action: 'read', sessionId: $('diagnostics-history').value });
    renderDiagnostics(); await persistMonitoring(); diagnosticFeedback('已切换会话。查看历史会话不会停止当前运行中的会话。');
  } catch (error) { diagnosticFeedback(friendly(error), true); }
});
const easyUI = setupEasyUI({ extension, command, download, notify, getWindowId: () => windowId });
init().catch(error => { draft ||= fresh(); notify(`初始化失败：${friendly(error)}`, true); });
