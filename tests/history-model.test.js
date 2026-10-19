import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_PAGE_SIZE, formatHistoryDate, getHistoryPage, localDateKey, parseHistoryDateQuery, parseHistoryPage } from '../history-model.js';

const records = count => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), startedAt: new Date(2026, 9, index + 1, 12).toISOString(), active: false }));

test('History has a fixed size of ten, keeps all 31 records, and sorts newest first without mutating input', () => {
  const source = records(31), first = getHistoryPage(source), last = getHistoryPage(source, { page: 4 });
  assert.equal(HISTORY_PAGE_SIZE, 10);
  assert.equal(first.total, 31); assert.equal(first.pageCount, 4);
  assert.deepEqual(first.items.map(item => item.id), ['31', '30', '29', '28', '27', '26', '25', '24', '23', '22']);
  assert.deepEqual(last.items.map(item => item.id), ['1']);
  assert.equal(last.first, 31); assert.equal(last.last, 31);
  assert.equal(source[0].id, '1');
});

test('Deleting the last record on a page falls back to the previous page, including an empty history', () => {
  const source = records(31).slice(1), result = getHistoryPage(source, { page: 4 });
  assert.equal(result.page, 3); assert.equal(result.pageCount, 3); assert.equal(result.items.length, 10);
  assert.deepEqual(getHistoryPage([], { page: 4 }), { items: [], total: 0, page: 1, pageCount: 1, first: 0, last: 0 });
});

test('Date searches accept year, month, day, slash, and Chinese formats', () => {
  for (const [input, expected] of [['', ''], ['2026', '2026'], ['2026/1', '2026-01'], ['2026 / 10 / 9', '2026-10-09'], ['2026年', '2026'], ['2026年10月', '2026-10'], ['2026年 10月 19日', '2026-10-19']]) {
    assert.equal(parseHistoryDateQuery(input), expected, input);
  }
  assert.equal(parseHistoryDateQuery('2000-02-29'), '2000-02-29');
  assert.equal(parseHistoryDateQuery('2024-2-29'), '2024-02-29');
});

test('Invalid calendar dates and incomplete date syntax are rejected in Chinese', () => {
  for (const input of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00', '2026-13', '2026-10-00', '0000', '26-10-19', '2026-', '2026/10/', '2026日', '2026-10-19T12:00', '<script>']) {
    assert.throws(() => parseHistoryDateQuery(input), /请输入有效的日期/, input);
  }
});

test('Date search uses local calendar dates around midnight and respects month/year boundaries', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Shanghai';
    const source = [{ id: 'after', startedAt: '2026-10-18T16:00:00.000Z' }, { id: 'before', startedAt: '2026-10-18T15:59:59.000Z' }, { id: 'invalid', startedAt: null }];
    assert.equal(localDateKey(source[0].startedAt), '2026-10-19');
    assert.equal(formatHistoryDate(source[0].startedAt), '2026-10-19 00:00:00');
    assert.deepEqual(getHistoryPage(source, { query: '2026-10-19' }).items.map(item => item.id), ['after']);
    assert.equal(getHistoryPage(source, { query: '2026' }).total, 2);
    assert.equal(getHistoryPage(source, { query: '2026-10' }).total, 2);
    assert.equal(getHistoryPage(source, { query: '2026-11' }).total, 0);
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(localDateKey(source[0].startedAt), '2026-10-18');
    assert.equal(getHistoryPage(source, { query: '2026-10-19' }).total, 0);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('Page jumps reject non-integers and out-of-range values instead of silently jumping', () => {
  assert.equal(parseHistoryPage(' 3 ', 4), 3);
  for (const value of ['', '0', '-1', '1.5', '1e1', '3foo', '5', '01', '9007199254740992']) assert.throws(() => parseHistoryPage(value, 4), /1 到 4/);
});
