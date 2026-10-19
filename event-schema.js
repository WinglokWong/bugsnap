export const eventCategories = ['errors', 'requests', 'navigation', 'actions', 'feedback', 'network', 'markers', 'evidence'];
export const emptyCounts = () => Object.fromEntries(eventCategories.map(k => [k, 0]));
export function redactText(value, length = 2000) {
  return String(value ?? '').slice(0, length)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已隐藏]')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]')
    .replace(/((?:password|token|secret|authorization|api[_-]?key|密码|验证码)\s*[:：=]\s*)[^\s,，;；]+/gi, '$1[已隐藏]');
}
export function sanitizeRecordedEvent(raw, category) {
  const e = raw && typeof raw === 'object' ? raw : {}, out = {};
  for (const name of ['kind', 'time', 'message', 'label', 'tag', 'selector', 'state', 'title', 'method', 'url', 'error', 'source', 'stack', 'destination', 'from', 'requestId', 'nearbyActionId']) {
    if (typeof e[name] === 'string') out[name] = redactText(e[name], ['message', 'stack', 'source', 'url', 'from', 'destination'].includes(name) ? 2000 : 250);
  }
  for (const name of ['line', 'column', 'x', 'y', 'duration']) if (Number.isFinite(e[name])) out[name] = Math.max(0, Math.min(100000000, Math.round(e[name])));
  if ('status' in e) out.status = Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : null;
  // Deliberately never copy value, text, formData, headers, body, or arbitrary attributes.
  if (category === 'actions' && e.label === '敏感字段') { out.label = '敏感字段'; out.message = '编辑或操作了敏感字段（内容未记录）'; out.selector = ''; delete out.state; }
  return out;
}
