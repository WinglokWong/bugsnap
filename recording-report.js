import { escapeHTML } from './report.js';
const labels = { actions: '用户操作', feedback: '页面反馈', navigation: '页面变化', network: '请求摘要', requests: '失败请求', errors: '程序错误', markers: '问题标记', evidence: '现场画面' };
const safeImage = value => typeof value === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value);
export function recordingFiles(session) {
  if (!session || session.previewOnly) throw new Error('需要完整记录才能导出，请重新读取记录。');
  const copy = structuredClone(session), files = [], images = new Map();
  for (const event of session.timeline || []) {
    if (safeImage(event.image) && !images.has(event.image)) {
      const name = `screenshots/${String(images.size + 1).padStart(3, '0')}.${event.image.startsWith('data:image/png') ? 'png' : 'jpg'}`;
      const raw = atob(event.image.split(',')[1]);
      files.push({ name, data: Uint8Array.from(raw, c => c.charCodeAt(0)) }); images.set(event.image, name);
    }
  }
  const stripImages = object => {
    if (!object || typeof object !== 'object') return;
    if (typeof object.image === 'string') { if (images.has(object.image)) object.imageFile = images.get(object.image); delete object.image; }
    for (const value of Object.values(object)) stripImages(value);
  };
  stripImages(copy);
  const e = escapeHTML, time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供';
  const events = copy.timeline || [];
  const title = `网页问题记录 · ${time(copy.startedAt)}`;
  const completed = new Set(events.filter(e => e.category === 'network' && ['fetch', 'xhr'].includes(e.kind)).map(e => e.requestId));
  const rows = events.map((event, index) => {
    const category = event.category, message = event.message || event.error || (category === 'network' ? `请求完成：${event.method || 'GET'} ${event.status || '无状态码'}` : event.kind || labels[category]);
    return `<article class="event ${category === 'markers' ? 'marked' : ''}" id="event-${index}"><div class="event-head"><span class="type">${e(labels[category] || category)}</span><time>${e(time(event.time || event.recordedAt))}</time></div><h3>${e(message)}</h3><p class="source">${e(event.pageUrl)}</p>${event.imageFile ? `<img src="${e(event.imageFile)}" alt="${e(message)}" loading="lazy">` : ''}${event.reason ? `<p>${e(event.reason)}</p>` : ''}${['fetch-start', 'xhr-start'].includes(event.kind) && !completed.has(event.requestId) ? '<p class="muted">记录结束前未收到此请求的完成事件；可能仍在处理中，或结束记录时尚未完成。</p>' : ''}<details><summary>技术详情</summary><pre>${e(JSON.stringify(event, null, 2))}</pre></details></article>`;
  }).join('');
  const counters = [['actions', '用户操作'], ['feedback', '页面反馈'], ['markers', '问题标记'], ['errors', '程序错误']].map(([key, text]) => `<div><b>${copy.counts?.[key] || 0}</b><span>${text}</span></div>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f5fa;color:#302b40;font:14px/1.75 system-ui,sans-serif}main{max-width:960px;margin:36px auto;padding:36px;background:white;border-radius:18px}header{border-bottom:1px solid #e9e5ef;padding-bottom:24px}h1{font-size:28px;margin:12px 0}h2{font-size:20px}h3{font-size:15px;margin:8px 0;overflow-wrap:anywhere}.brand{color:#7961cc;letter-spacing:.12em;font-size:12px}.muted,.source,time{font-size:12px;color:#8c849a}.source{overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.stats div{background:#f5f1fc;border-radius:10px;padding:13px}.stats b{font-size:26px;display:block;color:#775fc6}.stats span{font-size:12px}.note{white-space:pre-wrap;background:#faf8fc;border:1px solid #ece6f4;padding:18px;border-radius:10px}.event{border:1px solid #e9e4ef;border-radius:12px;padding:18px;margin:14px 0;break-inside:avoid}.marked{border-color:#efa783;background:#fff7ef}.event-head{display:flex;justify-content:space-between;gap:14px}.type{font-size:11px;color:#775fc6}.marked .type{color:#bf7544}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f8f7fa;padding:13px}details{font-size:12px;color:#81778d}summary{cursor:pointer}img{display:block;width:100%;height:auto;border:1px solid #eee;border-radius:8px;margin-top:14px}footer{margin-top:30px;color:#92899f;font-size:12px}@media(max-width:600px){main{margin:0;padding:20px}.stats{grid-template-columns:repeat(2,1fr)}}@media print{body{background:white}main{margin:0;padding:0}details{display:none}img{max-height:70vh;object-fit:contain}}</style></head><body><main><header><span class="brand">BUGSNAP / 网页问题记录</span><h1>${e(title)}</h1><p class="muted">开始：${e(time(copy.startedAt))} · 结束：${copy.stoppedAt ? e(time(copy.stoppedAt)) : '导出时仍在记录'}</p><p class="muted">记录编号：${e(copy.sessionId)} · 涉及 ${copy.pages?.length || 0} 个文档</p></header><div class="stats">${counters}</div><section><h2>用户补充</h2><p class="note">${e(copy.note || '用户未补充说明，请结合问题标记和时间线查看。')}</p></section><section><h2>记录范围</h2><p>${e(copy.coverage)}</p><p class="muted">输入仅记录填写状态，不包含输入原文。页面提示与截图可能含个人信息。请求 HTTP 成功不等于业务成功；时间相邻不代表确定的因果关系。</p>${copy.lastError ? `<p class="note">采集提示：${e(copy.lastError)}</p>` : ''}<details><summary>浏览器和窗口信息</summary><pre>${e(JSON.stringify(copy.environment || {}, null, 2))}</pre></details></section><h2>操作与反馈时间线</h2>${rows || '<p>本次没有捕获到事件。</p>'}<footer>本记录由用户主动开启并保存在本机。没有自动发送给任何人。完整结构化数据见同目录的「记录.json」。画面文件位于 screenshots 文件夹。</footer></main></body></html>`;
  return [{ name: '记录.html', data: html }, { name: '记录.json', data: JSON.stringify(copy, null, 2) }, { name: '先读我.txt', data: '请先解压整个 ZIP，再打开「记录.html」查看操作和页面反馈。\n开发人员可读取「记录.json」进行进一步排查。\n截图位于 screenshots 文件夹（如果本次成功保存了画面）。\n本记录不是屏幕录像，也不能保证识别所有类型的页面反馈。\n' }, ...files];
}
