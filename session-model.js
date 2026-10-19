import { emptyCounts, eventCategories } from './event-schema.js';
export function safePageURL(value) {
  try { const u = new URL(value); if (!/^https?:$/.test(u.protocol)) return ''; u.username = ''; u.password = ''; u.search = ''; u.hash = u.hash.startsWith('#/') ? u.hash.split('?')[0] : ''; return u.href.slice(0, 2000); } catch { return ''; }
}
export function newSession(tab, browserId, id) {
  return { id, recordingVersion: 2, browserId, active: true, startedAt: new Date().toISOString(), stoppedAt: null, primaryTabId: tab.id, tabIds: [tab.id], startUrl: safePageURL(tab.url), bindings: {}, counts: emptyCounts(), ownerWindowId: tab.windowId, followActive: false, screenshots: false, note: '', pages: [], status: 'recording', lastError: '', revision: 0 };
}
export function sessionSnapshot(session, events, full = false) {
  const sorted = events.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.receivedAt.localeCompare(b.receivedAt));
  const list = category => { const all = sorted.filter(e => e.category === category).map(e => ({ ...e.entry, ...(!full && e.entry.image ? { image: undefined, hasImage: true } : {}), pageUrl: e.pageUrl, pageDocumentId: e.pageDocumentId, tabId: e.tabId, recordedAt: e.receivedAt })); return full ? all : all.slice(-100); };
  return { version: 3, recordingVersion: session.recordingVersion || 1, scope: 'test-session', sessionId: session.id, active: session.active, startedAt: session.startedAt, stoppedAt: session.stoppedAt, clearedAt: session.clearedAt || null, pageUrl: session.startUrl, documentId: null,
    ownerWindowId: session.ownerWindowId, followActive: session.followActive, screenshots: session.screenshots, note: session.note || '', environment: session.environment || null,
    status: session.status, lastError: session.lastError, tabIds: session.tabIds, pages: session.pages, counts: session.counts, errors: list('errors'), requests: list('requests'), navigation: list('navigation'), actions: list('actions'), feedback: list('feedback'), network: list('network'), markers: list('markers'), evidence: list('evidence'),
    timeline: (full ? sorted : sorted.slice(-120)).map(e => ({ id: e.id, category: e.category, ...e.entry, pageUrl: e.pageUrl, tabId: e.tabId, pageDocumentId: e.pageDocumentId, recordedAt: e.receivedAt, ...(!full && e.entry.image ? { image: undefined, hasImage: true } : {}) })),
    dropped: session.losses || { errors: 0, requests: 0 },
    previewOnly: !full, truncated: !full && (eventCategories.some(k => session.counts[k] > 100)), readAt: new Date().toISOString(),
    coverage: '测试会话：已加入的标签页及其新开的子标签页；已授权 HTTP/HTTPS 网站跨页持续记录，直到手动停止。日志实时保存到本机。记录点击、填写状态、选择、提交、滚动、页面提示、弹窗、请求结果及程序错误；不记录输入原文、请求体或响应体。页面提示识别有覆盖边界，记录不等于完整屏幕录像。新文档建立连接前的极早期错误、受限页面、iframe/Worker 内部及浏览器关闭期间不在覆盖范围。' };
}
