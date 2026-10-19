// Attachment is a local operation on a previously read snapshot, not a new page read.
export function diagnosticAttachment(capture, monitoring, enforceSource = true) {
  if (!capture) return { ok: false, reason: '请先在要反馈的网页采集截图，再附加日志。' };
  if (!monitoring?.diagnostics) return { ok: false, reason: '还没有已读取的日志。请回到要反馈的网页：开始记录 → 复现问题 → 刷新日志。' };
  if (monitoring.diagnostics.scope === 'test-session') {
    if (enforceSource && !monitoring.diagnostics.pages.some(p => p.tabId === capture.tabId && p.pageDocumentId === capture.page.documentId)) return { ok: false, reason: '当前截图不是此测试会话中接入的页面。请在会话正在跟踪的页面采集截图，再附加整个会话。' };
    if (monitoring.diagnostics.previewOnly) return { ok: false, reason: '请先读取完整会话后再附加。' };
    return { ok: true, snapshot: structuredClone(monitoring.diagnostics) };
  }
  if (enforceSource) {
    if (monitoring.tabId !== capture.tabId) return { ok: false, reason: '日志与报告截图来自不同标签页。请回到报告对应的标签页读取日志，或为新的问题页面单独采集报告。' };
    if (monitoring.pageUrl !== capture.page.url) return { ok: false, reason: `日志页面（${shortPage(monitoring.pageUrl)}）与截图页面（${shortPage(capture.page.url)}）不同，未附加。请在要反馈的同一页面重新采集现场与日志。` };
    if (!capture.page.documentId || monitoring.diagnostics.documentId !== capture.page.documentId) return { ok: false, reason: '网页已刷新或重新导航，日志与截图不是同一次加载。请重新采集当前现场，再附加日志。' };
  }
  return { ok: true, snapshot: structuredClone(monitoring.diagnostics) };
}
export function shortPage(value) {
  try { const url = new URL(value); return `${url.origin === 'null' ? url.protocol : url.origin}${url.pathname}`; }
  catch { return '未采集页面'; }
}
export function diagnosticSummary(snapshot, cached = false) {
  if (!snapshot) return '尚未读取日志。这是程序错误记录器，不会自动判断按钮是否失效或样式是否正确。';
  const errors = snapshot.counts?.errors ?? snapshot.errors.length, requests = snapshot.counts?.requests ?? snapshot.requests.length;
  if (snapshot.scope === 'test-session') return `${snapshot.active ? '会话持续开启，直到你手动停止。' : '会话已停止，已保存的日志仍可导出。'}已保存 ${errors} 条错误、${requests} 条失败请求，经过 ${snapshot.pages.length} 个文档。${snapshot.truncated ? '面板只显示每类最近 100 条；完整导出保留全部。' : ''}${snapshot.lastError || ''}`;
  const prefix = cached ? '上次读取的快照。' : snapshot.active ? '记录中；复现问题后点击「刷新日志」更新计数。' : '已停止；下方是停止时的记录。';
  return `${prefix}${errors || requests ? `已读取 ${errors} 条程序错误、${requests} 条失败请求。` : '本次未捕获异常（0 条），不代表页面没有问题；按钮无反应也可能不产生程序报错。'}`;
}
