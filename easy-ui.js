import { recordingFiles } from './recording-report.js';
import { zip } from './report.js';
import { setupHistoryUI } from './history-ui.js';
import { localDateKey } from './history-model.js';
import { permissionOrigins, runtimeProblem } from './runtime-compat.js';
const $ = id => document.getElementById(id);
const names = { actions: '操作', feedback: '页面提示', navigation: '打开网页', network: '请求结果', requests: '请求失败', errors: '系统异常', markers: '问题标记', evidence: '画面' };
export function setupEasyUI({ extension, command, download, confirmDelete, getWindowId, onRuntimeError }) {
  let ready = false, unavailable = null;
  let session = null, running = false, busy = false, refreshTimer, historyTimer, noteTimer, demo = null, noteDraft = '', noteSessionId = null, noteDirty = false;
  const demos = [];
  function message(text, error = false) { $('easy-message').textContent = text; $('easy-message').classList.toggle('error', error); $('easy-message').hidden = !text; }
  function render() {
    running = Boolean(session?.active);
    const legacy = extension && running && session.recordingVersion !== 2;
    const otherWindow = extension && running && session.followActive && session.ownerWindowId !== getWindowId();
    const waiting = otherWindow || running && ['waiting', 'permission', 'storage-error'].includes(session.status);
    $('easy-status-title').textContent = legacy ? '请先结束旧版记录' : waiting ? '有网页暂时没有记录' : running ? '正在记录，你可以正常浏览' : session ? '记录已结束' : '把问题发生的过程留下来';
    $('easy-status-detail').textContent = legacy ? '旧记录只包含原来的诊断信息。结束并导出后，开始一份新记录，就能自动记录操作和页面反馈。' : otherWindow ? '这份记录在另一个窗口中进行。点击下面的按钮，可继续记录这个窗口的网页。' : waiting ? session.lastError || '回到要反馈的网页，点击下面的按钮继续。' : running ? '遇到不对劲的地方，点一下“这里有问题”。' : session ? '将导出的 ZIP 文件发给开发或维护人员即可。' : '不需要懂技术。开始后，照平时的方式使用网页就好。';
    $('easy-status').classList.toggle('recording', running && !waiting); $('easy-status').classList.toggle('waiting', waiting);
    if (!ready) {
      $('easy-status-title').textContent = unavailable?.title || '正在准备记录…';
      $('easy-status-detail').textContent = unavailable ? '请先处理上方的提示。' : '正在检查插件，准备好后就能开始。';
      $('easy-status').classList.remove('recording', 'waiting');
    }
    $('easy-start').hidden = running;
    $('easy-start').textContent = session ? '开始一份新记录' : '开始记录';
    $('easy-start').disabled = !ready || busy;
    $('easy-mark').disabled = !ready || busy || !running || legacy;
    $('easy-end').disabled = !ready || busy || !session;
    $('easy-end').textContent = running ? '结束并导出' : session ? '再次下载记录' : '结束并导出';
    $('easy-continue').hidden = !waiting || legacy; $('easy-continue').disabled = !ready || busy;
    $('easy-screenshots').disabled = !ready || running || busy;
    $('easy-note').disabled = !ready || busy;
    if (running && typeof session.screenshots === 'boolean') $('easy-screenshots').checked = session.screenshots;
    $('easy-count-actions').textContent = session?.counts?.actions || 0;
    $('easy-count-feedback').textContent = session?.counts?.feedback || 0;
    $('easy-count-markers').textContent = session?.counts?.markers || 0;
    $('easy-stats').hidden = !session; $('easy-note-area').hidden = !session;
    if (document.activeElement !== $('easy-note')) $('easy-note').value = noteDraft;
    $('easy-timeline').replaceChildren();
    const recent = (session?.timeline || []).filter(e => !['network', 'evidence'].includes(e.category)).slice(-8).reverse();
    for (const event of recent) {
      const item = document.createElement('li'), icon = document.createElement('span'), content = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
      icon.className = `easy-event-icon ${event.category === 'markers' ? 'issue' : ''}`; icon.textContent = event.category === 'markers' ? '!' : '·';
      title.textContent = event.category === 'navigation' && event.kind === 'navigation' ? '打开了网页' : event.message || event.error || names[event.category];
      meta.textContent = `${new Date(event.time || event.recordedAt).toLocaleTimeString('zh-CN')} · ${names[event.category] || '记录'}`;
      content.append(title, meta); item.append(icon, content); $('easy-timeline').append(item);
    }
    $('easy-recent').hidden = !recent.length;
    $('easy-history').disabled = !ready || busy;
    historyUI.setEnabled(ready && !busy);
  }
  async function refresh() {
    if (extension) session = (await command('DIAGNOSTICS', { action: 'read' })).diagnostics;
    else session = demo;
    if (noteSessionId !== session?.sessionId) { noteSessionId = session?.sessionId; noteDraft = session?.note || ''; noteDirty = false; }
    else if (!noteDirty) noteDraft = session?.note || '';
    render();
  }
  function historyError(error) {
    if (runtimeProblem(error)) onRuntimeError(error);
  }
  const historyUI = setupHistoryUI({
    list: async () => extension ? (await command('DIAGNOSTICS', { action: 'list' })).sessions : demos.map(data => ({ ...data, id: data.sessionId })),
    read: async id => extension ? (await command('DIAGNOSTICS', { action: 'read', sessionId: id, full: true })).diagnostics : demos.find(data => data.sessionId === id),
    remove: async id => {
      if (extension) await command('DIAGNOSTICS', { action: 'delete', sessionId: id });
      else {
        const index = demos.findIndex(data => data.sessionId === id);
        if (index < 0) throw new Error('这份记录已不存在。');
        if (demos[index].active) throw new Error('请先结束记录，再删除。');
        demos.splice(index, 1);
      }
    },
    download: exportSession, confirmDelete, onError: historyError,
    onDeleted: async id => {
      if (session?.sessionId === id) {
        clearTimeout(noteTimer); session = null; demo = null;
        noteSessionId = null; noteDraft = ''; noteDirty = false;
        message('这份记录已删除。可以开始一份新记录。');
      }
      await refresh();
    }
  });
  async function history() { return historyUI.refresh(); }
  async function run(fn) {
    if (!ready || busy) return;
    busy = true; render();
    try { await fn(); }
    catch (error) {
      if (runtimeProblem(error)) onRuntimeError(error);
      else message(error.message || '暂时没有完成，请重试。', true);
    }
    finally { busy = false; if (ready) await refresh().catch(() => {}); render(); }
  }
  function demoPicture() {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 620;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f3f4f8'; ctx.fillRect(0, 0, 1000, 620);
    ctx.fillStyle = '#fff'; ctx.fillRect(190, 100, 620, 400);
    ctx.fillStyle = '#443c58'; ctx.font = '28px system-ui'; ctx.fillText('账户信息 · 示例页面', 240, 165);
    ctx.fillStyle = '#f4f1f9'; ctx.fillRect(240, 210, 510, 65);
    ctx.fillStyle = '#7660d9'; ctx.fillRect(240, 310, 140, 52); ctx.fillStyle = '#fff'; ctx.font = '22px system-ui'; ctx.fillText('保存', 288, 344);
    ctx.fillStyle = '#fff0e8'; ctx.fillRect(240, 395, 510, 55); ctx.fillStyle = '#b86d45'; ctx.fillText('保存失败，请稍后重试', 264, 430);
    ctx.fillStyle = '#a299b0'; ctx.font = '16px system-ui'; ctx.fillText('仅用于界面预览的模拟画面', 360, 560);
    return canvas.toDataURL('image/png');
  }
  function exportSession(data) {
    if (!data) throw new Error('还没有可以下载的记录。');
    download(zip(recordingFiles(data)), `网页问题记录-${localDateKey(data.startedAt)}-${data.sessionId.slice(0, 8)}.zip`);
    message('下载已发起。把 ZIP 文件发给维护人员即可；需要时也能再次下载。');
  }
  function demoEvent(category, kind, text, extra = {}) {
    const event = { id: crypto.randomUUID(), category, kind, message: text, time: new Date().toISOString(), recordedAt: new Date().toISOString(), pageUrl: 'https://example.com/account', ...extra };
    demo.timeline.push(event); demo.counts[category] = (demo.counts[category] || 0) + 1;
  }
  $('easy-start').addEventListener('click', () => run(async () => {
    const screenshots = $('easy-screenshots').checked;
    if (extension) {
      // Must be invoked before any await, while the click's user gesture is active.
      const granted = await chrome.permissions.request({ origins: permissionOrigins(chrome, screenshots) });
      if (!granted) throw new Error('还没有得到浏览器允许。请再次点击“开始记录”，并在浏览器提示里选择允许。');
      session = (await command('DIAGNOSTICS', { action: 'start', followActive: true, screenshots })).diagnostics;
      if (screenshots) await command('DIAGNOSTICS', { action: 'evidence' });
    } else {
      demo = { sessionId: crypto.randomUUID(), active: true, status: 'recording', scope: 'test-session', startedAt: new Date().toISOString(), stoppedAt: null, previewOnly: false, recordingVersion: 2, screenshots, note: '', counts: { actions: 0, feedback: 0, markers: 0, errors: 0 }, pages: [{ url: 'https://example.com/account' }], timeline: [], coverage: '界面演示数据，不是对当前网页的真实采集。' };
      demos.unshift(demo);
      demoEvent('actions', 'click', '点击了“保存”'); demoEvent('feedback', 'page-message', '页面显示：保存失败，请稍后重试'); session = demo;
    }
    message(extension ? '已经开始。你可以回到网页操作，关闭侧边栏也会继续记录。' : '这是演示记录。真实记录需要在 Chrome 加载插件后使用。');
    await history();
  }));
  $('easy-mark').addEventListener('click', () => run(async () => {
    if (extension) {
      const result = await command('DIAGNOSTICS', { action: 'mark', sessionId: session.sessionId });
      message(result.evidence?.saved ? '已标记这个时刻，并保存了当前画面。你可以继续操作。' : `已标记这个时刻，操作记录已保留。${result.evidence?.reason ? `画面未保存：${result.evidence.reason}。` : ''}`);
    } else { demoEvent('markers', 'problem', '用户在这里遇到了问题'); if (demo.screenshots) demoEvent('evidence', 'screenshot', '示例画面（预览）', { image: demoPicture() }); message('已标记这个时刻。你可以继续操作。'); }
    $('easy-note-area').hidden = false;
  }));
  $('easy-end').addEventListener('click', () => run(async () => {
    clearTimeout(noteTimer);
    if (extension) {
      if (session.active) await command('DIAGNOSTICS', { action: 'stop', sessionId: session.sessionId, note: noteDraft });
      else await command('DIAGNOSTICS', { action: 'note', sessionId: session.sessionId, note: noteDraft });
      exportSession((await command('DIAGNOSTICS', { action: 'read', sessionId: session.sessionId, full: true })).diagnostics);
    } else { demo.active = false; demo.status = 'stopped'; demo.stoppedAt = new Date().toISOString(); demo.note = noteDraft; exportSession(demo); }
    noteDirty = false; await history();
  }));
  $('easy-continue').addEventListener('click', () => run(async () => {
    if (extension) {
      const granted = await chrome.permissions.request({ origins: permissionOrigins(chrome, false) });
      if (!granted) throw new Error('浏览器还没有允许记录这个网页。');
      await command('DIAGNOSTICS', { action: 'join', followActive: true });
    }
    message('已尝试继续记录当前网页。');
  }));
  $('easy-note').addEventListener('input', () => {
    if (!ready) return;
    noteDraft = $('easy-note').value; noteDirty = true;
    if (session) session.note = noteDraft;
    clearTimeout(noteTimer); noteTimer = setTimeout(() => {
      if (ready && extension && session) {
        const id = session.sessionId, text = noteDraft;
        command('DIAGNOSTICS', { action: 'note', sessionId: id, note: text }).then(() => {
          if (session?.sessionId === id && noteDraft === text) noteDirty = false;
        }).catch(error => message(`补充说明暂未保存：${error.message}`, true));
      }
    }, 500);
  });
  $('easy-history').addEventListener('click', () => run(async () => {
    const panel = $('history-panel'); panel.hidden = !panel.hidden;
    $('easy-history').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) await history();
  }));
  if (extension) chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('diagnosticSessionStatus' in changes) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if (ready && !busy) void refresh().catch(historyError); }, 300);
    }
    if ('diagnosticHistoryRevision' in changes) {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => { if (ready && !$('history-panel').hidden) void history().catch(historyError); }, 300);
    }
  });
  function setReady(value, reason = null) { ready = value; unavailable = reason; if (!ready) { clearTimeout(noteTimer); message(''); } render(); }
  render();
  return { refresh, history, setReady };
}
