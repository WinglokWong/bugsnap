export const severityNames = { critical: '致命', high: '高', medium: '中', low: '低' };
export const escapeMarkdown = value => String(value ?? '').replace(/[\\`*_{}\[\]<>#|!]/g, '\\$&');
const code = value => '`' + String(value ?? '').replace(/`/g, 'ˋ').replace(/[\r\n]/g, ' ') + '`';
export function markdown(report, imagePath = '', attachments = Boolean(imagePath)) {
  const p = report.capture?.page;
  const el = report.capture?.element;
  const section = (label, value) => `\n## ${label}\n\n${escapeMarkdown(value || '未填写')}\n`;
  return `# ${escapeMarkdown(report.title)}\n\n- 严重程度：${severityNames[report.severity] || '中'}\n- 报告编号：${report.id}\n- 创建时间：${report.createdAt}\n` +
    (p ? `- 页面标题：${escapeMarkdown(p.title)}\n- 页面：${code(p.url)}\n- 采集时间：${p.capturedAt}\n- 浏览器：${code(p.browser)}\n- 操作系统：${escapeMarkdown(p.platform)}\n- 屏幕尺寸：${p.screen.width} × ${p.screen.height}\n- 窗口尺寸：${p.window.width} × ${p.window.height}\n- 视口尺寸：${p.viewport.width} × ${p.viewport.height}\n- 像素比：${p.devicePixelRatio}\n` : '- 页面：未采集\n') +
    (el ? `- 问题元素：${code(el.selector)}\n- 元素标签：${code(el.tag)}\n- 元素文本：${escapeMarkdown(el.text)}\n- 元素属性：${code(JSON.stringify(el.attributes))}\n` : '') +
    section('问题描述', report.description) + '\n## 复现步骤\n\n' +
    (report.steps.split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => `${i + 1}. ${escapeMarkdown(s.replace(/^\d+[.、]\s*/, ''))}`).join('\n') || '未填写') + '\n' +
    section('期望结果', report.expected) + section('实际结果', report.actual) +
    (report.capture?.screenshot ? `\n## 问题截图\n\n${imagePath ? `![问题截图](${imagePath})` : '已采集截图，请将导出的 PNG 图片作为附件上传。'}\n` : '') +
    diagnosticsMarkdown(report) + comparisonMarkdown(report, attachments) +
    '\n---\n由 BugSnap 生成 · 本地报告\n';
}
function diagnosticsMarkdown(report) {
  const d = report.includeDiagnostics === false ? null : report.capture?.diagnostics;
  if (!d) return '\n## 运行诊断\n\n未附加运行日志。\n';
  return (d.scope === 'test-session' ? `\n## 测试会话\n\n- 会话编号：${escapeMarkdown(d.sessionId)}\n- 涉及文档：${d.pages.length} 个\n- 记录页面：\n${d.pages.map(p => `  - ${code(p.time)} ${code(p.url)}`).join('\n')}\n` : '') + `\n## 运行诊断\n\n- 开始时间：${escapeMarkdown(d.startedAt)}\n- 停止时间：${escapeMarkdown(d.stoppedAt || '采集时仍在记录')}\n- 覆盖范围：${escapeMarkdown(d.coverage)}\n- JS / 控制台错误：${d.errors.length} 条；失败请求：${d.requests.length} 条\n- 未保存 / 丢弃：错误 ${d.dropped.errors} 条 / 请求 ${d.dropped.requests} 条\n\n### JavaScript 与控制台错误\n\n` +
    (d.errors.map(e => `- ${code(e.time)} **${escapeMarkdown(e.kind)}** ${escapeMarkdown(e.message)}${e.pageUrl ? ` · 页面 ${code(e.pageUrl)}` : ''}${e.source ? ` · ${code(e.source)}:${e.line}:${e.column}` : ''}${e.stack ? `\n\n${escapeMarkdown(e.stack)}\n` : ''}`).join('\n') || '本次记录范围内未捕获错误。') +
    '\n\n### 失败请求与资源\n\n' + (d.requests.map(r => `- ${code(r.time)} ${code(r.method)} ${code(r.url)} · ${r.status || '无状态码'} · ${escapeMarkdown(r.error)} (${escapeMarkdown(r.kind)})${r.pageUrl ? ` · 页面 ${code(r.pageUrl)}` : ''}`).join('\n') || '本次记录范围内未捕获失败请求。') + '\n';
}
function comparisonMarkdown(report, attachments) {
  const c = report.comparison;
  if (!c) return '';
  return `\n## 截图对比\n\n- 基准：${escapeMarkdown(c.before.title)} (${c.before.id})\n- 对照：${escapeMarkdown(c.after.title)} (${c.after.id})\n- 差异比例：${c.percentage.toFixed(3)}%（${c.changed} / ${c.total} 像素）\n- 原图尺寸：${c.originalWidth} × ${c.originalHeight}\n- 对比尺寸：${c.width} × ${c.height}（缩放比例 ${c.scale.toFixed(3)}）\n- 颜色容差：${c.threshold} / 255\n- 提示：像素变化不等于缺陷；动画、字体和滚动位置都会影响结果。\n\n` +
    (attachments ? '![基准截图](comparison-before.png)\n\n![对照截图](comparison-after.png)\n\n![差异高亮](comparison-diff.png)\n' : '对比图片请见 HTML、JSON 或 Markdown 报告包。\n');
}
export function normalizedRect(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; }
export function canvasPoint(event, rect, width, height) {
  return { x: Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width)), y: Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height)) };
}
export function paint(ctx, image, annotations) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(image, 0, 0);
  const scale = ctx.canvas.width / 1000;
  for (const mark of annotations) {
    ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = Math.max(3, 3 * scale);
    if (mark.type === 'rect') ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
    else if (mark.type === 'arrow') {
      const angle = Math.atan2(mark.endY - mark.y, mark.endX - mark.x), head = Math.max(12, 16 * scale);
      ctx.beginPath(); ctx.moveTo(mark.x, mark.y); ctx.lineTo(mark.endX, mark.endY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mark.endX, mark.endY);
      ctx.lineTo(mark.endX - head * Math.cos(angle - Math.PI / 6), mark.endY - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(mark.endX - head * Math.cos(angle + Math.PI / 6), mark.endY - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath(); ctx.fill();
    } else if (mark.type === 'text') {
      ctx.font = `600 ${Math.max(18, 22 * scale)}px system-ui`; ctx.textBaseline = 'top';
      const w = ctx.measureText(mark.text).width;
      ctx.fillStyle = '#ffffffeb'; ctx.fillRect(mark.x - 4, mark.y - 3, w + 8, Math.max(18, 22 * scale) + 8);
      ctx.fillStyle = mark.color; ctx.fillText(mark.text, mark.x, mark.y);
    }
  }
}
// A dependency-free ZIP writer (stored entries, UTF-8). Markdown and screenshot travel together.
export function zip(files) {
  const encoder = new TextEncoder(); const chunks = [], entries = []; let offset = 0;
  const crc32 = data => { let crc = -1; for (const b of data) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
  for (const file of files) {
    const name = encoder.encode(file.name), data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer), crc = crc32(data);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
    entries.push({ name, data, crc, offset }); chunks.push(header, data); offset += header.length + data.length;
  }
  const start = offset;
  for (const e of entries) {
    const h = new Uint8Array(46 + e.name.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x800, true);
    v.setUint32(16, e.crc, true); v.setUint32(20, e.data.length, true); v.setUint32(24, e.data.length, true); v.setUint16(28, e.name.length, true); v.setUint32(42, e.offset, true); h.set(e.name, 46); chunks.push(h); offset += h.length;
  }
  const end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true); v.setUint32(12, offset - start, true); v.setUint32(16, start, true); chunks.push(end);
  return new Blob(chunks, { type: 'application/zip' });
}

export function exportReport(report) {
  const copy = structuredClone(report);
  delete copy.requestId;
  if (copy.includeDiagnostics === false && copy.capture) delete copy.capture.diagnostics;
  return copy;
}
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeImage = value => typeof value === 'string' && /^data:image\/(?:png|jpeg);base64,[a-z\d+/=\r\n]+$/i.test(value) ? value : '';
export function htmlReport(input, screenshot = '') {
  const report = exportReport(input), e = escapeHTML, p = report.capture?.page, el = report.capture?.element;
  const section = (title, text) => `<section><h2>${e(title)}</h2><p class="text">${e(text || '未填写')}</p></section>`;
  const image = (label, value) => safeImage(value) ? `<figure><img alt="${e(label)}" src="${safeImage(value)}"><figcaption>${e(label)}</figcaption></figure>` : '';
  const d = report.capture?.diagnostics, c = report.comparison;
  const environment = p ? `<section><h2>采集环境</h2><dl>${Object.entries({ 页面标题: p.title, 页面地址: p.url, 采集时间: p.capturedAt, 浏览器: p.browser, 平台: p.platform, 屏幕尺寸: `${p.screen.width} × ${p.screen.height}`, 窗口尺寸: `${p.window.width} × ${p.window.height}`, 视口尺寸: `${p.viewport.width} × ${p.viewport.height}`, 像素比: p.devicePixelRatio }).map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl></section>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(report.title)} · BugSnap</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f5fa;color:#302c41;font:14px/1.8 system-ui,sans-serif}main{max-width:900px;background:white;margin:40px auto;padding:48px;border:1px solid #e8e4f0;border-radius:16px}header{border-bottom:1px solid #e8e4f0;padding-bottom:24px}header>p{color:#8b77b8;font-size:12px;letter-spacing:1px}h1{font-size:30px;line-height:1.4;overflow-wrap:anywhere}h2{font-size:18px;margin-top:0}h3{font-size:14px}section{margin-top:28px}dl{display:grid;grid-template-columns:100px 1fr;gap:8px;font-size:12px}dt{color:#9c92ab}dd{margin:0;overflow-wrap:anywhere}pre,.text{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#f7f5fa;padding:16px;border-radius:8px;font-size:12px}img{width:100%;height:auto;border:1px solid #eee;border-radius:8px}figure{margin:20px 0}figcaption,footer,.muted{color:#a298b1;font-size:12px}footer{border-top:1px solid #eee;margin-top:32px;padding-top:20px}.badge{background:#f0eafa;color:#8366b6;padding:5px 12px;border-radius:20px;font-size:12px}li{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){main{margin:0;padding:24px;border-radius:0}}@media print{body{background:white}main{margin:0;border:0;padding:0}img{max-height:80vh;object-fit:contain}figure{break-inside:avoid}h2{break-after:avoid}}</style></head><body><main><header><p>BUGSNAP / 缺陷报告</p><h1>${e(report.title)}</h1><span class="badge">严重程度：${e(severityNames[report.severity] || '中')}</span><p class="muted">${e(report.id)} · ${e(report.createdAt)}</p></header>${environment}${el ? `<section><h2>问题元素</h2><pre>${e(JSON.stringify(el, null, 2))}</pre></section>` : ''}${section('问题描述', report.description)}<section><h2>复现步骤</h2><ol>${report.steps.split('\n').map(s => s.trim()).filter(Boolean).map(s => `<li>${e(s.replace(/^\d+[.、]\s*/, ''))}</li>`).join('') || '<li>未填写</li>'}</ol></section>${section('期望结果', report.expected)}${section('实际结果', report.actual)}${image('问题截图（含标注）', screenshot || report.annotatedScreenshot || report.capture?.screenshot)}${d ? `<section><h2>运行诊断</h2><p class="muted">${e(d.coverage)}</p><p>错误 ${d.errors.length} 条 · 失败请求 ${d.requests.length} 条</p><pre>${e(JSON.stringify(d, null, 2))}</pre></section>` : '<section><h2>运行诊断</h2><p>未附加运行日志。</p></section>'}${c ? `<section><h2>截图对比</h2><p>变化像素 <strong>${c.percentage.toFixed(3)}%</strong> · 容差 ${e(c.threshold)} / 255</p><p class="muted">原图 ${c.originalWidth} × ${c.originalHeight}；分析 ${c.width} × ${c.height}。像素变化不等于缺陷。</p>${image(`基准：${c.before.title}`, c.before.image)}${image(`对照：${c.after.title}`, c.after.image)}${image('差异高亮', c.diffImage)}</section>` : ''}<footer>由 BugSnap 生成 · 本文件含所有图片，可离线查看或通过浏览器打印为 PDF。</footer></main></body></html>`;
}
