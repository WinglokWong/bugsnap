import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHistoryUI } from '../history-ui.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const records = count => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), startedAt: new Date(2026, 9, index + 1, 12).toISOString(), active: false }));

function setup(source = records(31)) {
  const nodes = new Map(), errors = [], removed = [], downloads = [], deleted = [], confirmations = [];
  const create = tag => ({
    tag, textContent: '', value: '', hidden: false, disabled: false, dataset: {}, attributes: {}, children: [], listeners: {},
    classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    querySelectorAll(tagName) { return this.children.flatMap(child => [...(child.tag === tagName ? [child] : []), ...child.querySelectorAll(tagName)]); }
  });
  const node = id => { if (!nodes.has(id)) nodes.set(id, create('div')); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: create };
  let data = source, list = async () => data.slice(), confirmation = true, removeError;
  const ui = setupHistoryUI({
    list: () => list(), read: async id => ({ sessionId: id }), download: async session => downloads.push(session),
    remove: async id => { if (removeError) throw removeError; removed.push(id); data = data.filter(item => item.id !== id); },
    confirmDelete: async item => { confirmations.push(item.id); return confirmation instanceof Promise ? await confirmation : confirmation; },
    onError: error => errors.push(error), onDeleted: id => deleted.push(id)
  });
  ui.setEnabled(true);
  const fire = (id, type = 'click') => node(id).listeners[type]({ preventDefault() {} });
  const buttons = () => node('easy-history-list').querySelectorAll('button');
  return { ui, node, fire, buttons, errors, removed, downloads, deleted, confirmations, setList(fn) { list = fn; }, setConfirmation(value) { confirmation = value; }, failDelete(error) { removeError = error; } };
}

test('History UI paginates all records, validates jumps, and resets to page one after search/reset', async () => {
  const h = setup(); await h.ui.refresh();
  assert.equal(h.buttons().length, 20); assert.equal(h.node('history-pagination').hidden, false);
  h.node('history-page').value = '4'; h.fire('history-page-form', 'submit');
  assert.equal(h.buttons().length, 2); assert.match(h.node('history-summary').textContent, /31–31/);
  h.node('history-page').value = '8'; h.fire('history-page-form', 'submit');
  assert.match(h.node('history-feedback').textContent, /1 到 4/); assert.equal(h.buttons().length, 2);
  h.node('history-date').value = '2026/10/1'; h.fire('history-search-form', 'submit');
  assert.equal(h.node('history-page').value, '1'); assert.equal(h.node('history-pagination').hidden, true);
  assert.equal(h.buttons().length, 2); assert.equal(h.node('history-date').value, '2026-10-01');
  h.node('history-date').value = '2026-02-30'; h.fire('history-search-form', 'submit');
  assert.match(h.node('history-feedback').textContent, /有效的日期/); assert.equal(h.buttons().length, 2);
  h.fire('history-reset'); assert.equal(h.buttons().length, 20); assert.equal(h.node('history-page').value, '1');
});

test('History deletes only the confirmed record and falls back after deleting the last page', async () => {
  const h = setup(); await h.ui.refresh();
  h.node('history-page').value = '4'; h.fire('history-page-form', 'submit');
  await h.buttons()[1].listeners.click();
  assert.deepEqual(h.removed, ['1']); assert.deepEqual(h.deleted, ['1']);
  assert.equal(h.node('history-page').value, '3'); assert.equal(h.buttons().length, 20);
  assert.match(h.node('history-feedback').textContent, /已删除/);
});

test('Cancelled and active-record deletion never call the backend; duplicate clicks are ignored', async () => {
  const h = setup([{ ...records(1)[0], active: true }, { ...records(2)[1], active: false }]); await h.ui.refresh();
  const activeDelete = h.buttons().find(button => button.dataset.active === 'true');
  assert.equal(activeDelete.disabled, true); await activeDelete.listeners.click(); assert.deepEqual(h.confirmations, []);
  h.setConfirmation(false); await h.buttons()[1].listeners.click(); assert.deepEqual(h.removed, []);
  const pending = deferred(); h.setConfirmation(pending.promise);
  const button = h.buttons()[1], deletion = button.listeners.click();
  await button.listeners.click(); assert.equal(h.confirmations.length, 2);
  pending.resolve(true); await deletion; assert.deepEqual(h.removed, ['2']);
});

test('A failed delete or list refresh leaves previously loaded records visible', async () => {
  const h = setup(records(2)); await h.ui.refresh();
  h.failDelete(new Error('磁盘写入失败')); await h.buttons()[1].listeners.click();
  assert.equal(h.buttons().length, 4); assert.match(h.node('history-feedback').textContent, /磁盘写入失败/);
  h.setList(async () => { throw new Error('读取失败'); }); assert.equal(await h.ui.refresh(), false);
  assert.equal(h.buttons().length, 4); assert.match(h.node('history-feedback').textContent, /读取失败/);
  assert.equal(h.errors.length, 2);
});

test('A slow older refresh cannot replace newer data or error state', async () => {
  const h = setup(), old = deferred(), fresh = deferred(); let call = 0;
  h.setList(() => (++call === 1 ? old.promise : fresh.promise));
  const first = h.ui.refresh(), second = h.ui.refresh();
  fresh.resolve(records(2)); assert.equal(await second, true);
  old.reject(new Error('过期请求失败')); assert.equal(await first, false);
  assert.equal(h.buttons().length, 4); assert.deepEqual(h.errors, []);
  assert.equal(h.node('history-feedback').textContent, '');
});

test('Downloads read the exact selected record; disabled state blocks actions and empty search is helpful', async () => {
  const h = setup(records(2)); await h.ui.refresh();
  await h.buttons()[0].listeners.click(); assert.deepEqual(h.downloads, [{ sessionId: '2' }]);
  h.ui.setEnabled(false); await h.buttons()[0].listeners.click(); assert.equal(h.downloads.length, 1);
  assert.equal(h.node('history-date').disabled, true);
  h.ui.setEnabled(true); h.node('history-date').value = '2025'; h.fire('history-search-form', 'submit');
  assert.equal(h.buttons().length, 0); assert.match(h.node('easy-history-list').children[0].textContent, /这个日期没有记录/);
  assert.match(h.node('history-summary').textContent, /共 0 条/);
});
