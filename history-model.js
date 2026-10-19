export const HISTORY_PAGE_SIZE = 10;

const pad = value => String(value).padStart(2, '0');

function validDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localDateKey(value) {
  const date = validDate(value);
  return date ? `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

export function formatHistoryDate(value) {
  const date = validDate(value);
  return date ? `${localDateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : '日期未知';
}

export function parseHistoryDateQuery(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  const match = /[年月日]/.test(input)
    ? /^(\d{4})\s*年(?:\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?)?$/.exec(input)
    : /^(\d{4})(?:\s*[-/]\s*(\d{1,2})(?:\s*[-/]\s*(\d{1,2}))?)?$/.exec(input);
  const invalid = () => { throw new Error('请输入有效的日期，例如 2026、2026-10 或 2026-10-19。'); };
  if (!match) return invalid();
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1) return invalid();
  if (match[2] && (month < 1 || month > 12)) return invalid();
  if (match[3]) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) return invalid();
  }
  return `${match[1]}${match[2] ? `-${pad(month)}` : ''}${match[3] ? `-${pad(day)}` : ''}`;
}

export function getHistoryPage(records, { query = '', page = 1 } = {}) {
  const dateQuery = parseHistoryDateQuery(query);
  const filtered = records.filter(record => !dateQuery || localDateKey(record.startedAt).startsWith(dateQuery));
  filtered.sort((a, b) => (validDate(b.startedAt)?.getTime() ?? -Infinity) - (validDate(a.startedAt)?.getTime() ?? -Infinity));
  const total = filtered.length, pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(pageCount, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  const offset = (currentPage - 1) * HISTORY_PAGE_SIZE;
  return { items: filtered.slice(offset, offset + HISTORY_PAGE_SIZE), total, page: currentPage, pageCount, first: total ? offset + 1 : 0, last: Math.min(offset + HISTORY_PAGE_SIZE, total) };
}

export function parseHistoryPage(value, pageCount) {
  const input = String(value ?? '').trim(), page = Number(input);
  if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(page) || page > pageCount) {
    throw new Error(`请输入 1 到 ${pageCount} 之间的整数页码。`);
  }
  return page;
}
