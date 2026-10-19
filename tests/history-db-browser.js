import { sessionDB } from '../session-db.js';
import { newSession } from '../session-model.js';

const prefix = `history-delete-fixture-${crypto.randomUUID()}`;
const ids = Object.fromEntries(['target', 'preserved', 'active', 'rollback'].map(name => [name, `${prefix}-${name}`]));
const owned = new Set(Object.values(ids));
let failures = 0, passed = 0;
const assert = (value, message) => { if (!value) throw new Error(message || '断言失败'); };
const equal = (left, right, message) => assert(JSON.stringify(left) === JSON.stringify(right), message);
const own = id => { assert(owned.has(id), '禁止访问不属于本次测试的记录'); return id; };
const get = id => sessionDB.get(own(id));
const events = id => sessionDB.events(own(id));
const remove = id => sessionDB.delete(own(id));

async function rejected(action, pattern) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert(failure, '预期删除应失败');
  if (pattern) assert(pattern.test(failure.message), `错误提示不符：${failure.message}`);
}

async function test(name, action) {
  const row = document.createElement('li');
  try { await action(); passed++; row.className = 'pass'; row.textContent = `PASS · ${name}`; }
  catch (error) { failures++; row.className = 'fail'; row.textContent = `FAIL · ${name}：${error.message}`; }
  document.getElementById('results').append(row);
}

async function seed(id, active) {
  own(id);
  const record = newSession({ id: 999, windowId: 999, url: 'https://fixture.invalid/history-test' }, `${prefix}-browser`, id);
  Object.assign(record, { active, status: active ? 'recording' : 'stopped', stoppedAt: active ? null : new Date().toISOString(), note: 'Synthetic note only', pages: [{ title: 'Synthetic page', url: 'https://fixture.invalid/history-test' }] });
  await sessionDB.put(record);
  for (const [index, category] of ['actions', 'errors', 'evidence'].entries()) {
    await sessionDB.append(record, {
      sessionId: id, id: `${id}-event-${index}`, category, order: index,
      receivedAt: new Date().toISOString(), entry: { message: `Synthetic ${category}`, ...(category === 'evidence' ? { image: 'data:image/jpeg;base64,AA==' } : {}) }
    });
  }
}

async function cursorDeleteDescriptor(id) {
  own(id);
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bugsnap-sessions', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = connection.transaction('events'), request = tx.objectStore('events').index('sessionId').openCursor(id);
      let result;
      request.onsuccess = () => {
        // Browsers can expose delete directly on IDBCursorWithValue rather than
        // inherit it from IDBCursor. Patch the actual cursor's method owner.
        let owner = request.result;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, 'delete')) owner = Object.getPrototypeOf(owner);
        if (owner) result = { owner, descriptor: Object.getOwnPropertyDescriptor(owner, 'delete') };
      };
      tx.oncomplete = () => result ? resolve(result) : reject(new Error('找不到测试 cursor 的 delete 方法'));
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { connection.close(); }
}

try {
  for (const [name, id] of Object.entries(ids)) await seed(id, name === 'active');
  const keepBefore = await get(ids.preserved), keepEventsBefore = await events(ids.preserved);
  await test('删除指定历史：元数据、备注、页面及全部事件和截图一并移除', async () => {
    assert((await events(ids.target)).some(event => event.entry.image), '截图合成数据未写入');
    await remove(ids.target);
    assert(await get(ids.target) === undefined, '历史元数据仍存在');
    equal(await events(ids.target), [], '历史事件或截图仍存在');
  });
  await test('删除一条记录不修改其他历史记录或截图', async () => {
    equal(await get(ids.preserved), keepBefore, '其他历史元数据发生变化');
    equal(await events(ids.preserved), keepEventsBefore, '其他历史事件发生变化');
  });
  await test('正在录制的记录不可删除，原记录及事件保持完整', async () => {
    const before = await get(ids.active), beforeEvents = await events(ids.active);
    await rejected(() => remove(ids.active), /先结束记录/);
    equal(await get(ids.active), before, '正在录制的记录发生变化');
    equal(await events(ids.active), beforeEvents, '正在录制的事件发生变化');
  });
  await test('重复删除返回友好错误，不影响其他记录', async () => {
    await rejected(() => remove(ids.target), /已不存在/);
    equal(await get(ids.preserved), keepBefore, '其他历史元数据发生变化');
    equal(await events(ids.preserved), keepEventsBefore, '其他历史事件发生变化');
  });
  await test('删除中途事务中断时，元数据和已删除的截图事件全部回滚', async () => {
    const before = await get(ids.rollback), beforeEvents = await events(ids.rollback);
    const { owner, descriptor } = await cursorDeleteDescriptor(ids.rollback);
    const originalDelete = descriptor.value;
    let intercepted = false, interrupted = false;
    // Interrupt only a cursor belonging to this fixture's known record.
    Object.defineProperty(owner, 'delete', { ...descriptor, value: function (...args) {
      const request = originalDelete.apply(this, args);
      if (!intercepted && this.value?.sessionId === ids.rollback) {
        intercepted = true;
        const tx = this.source.objectStore.transaction;
        request.addEventListener('success', () => { tx.abort(); interrupted = true; }, { once: true });
      }
      return request;
    } });
    let didReject = false, failure;
    try { await remove(ids.rollback); } catch (error) { didReject = true; failure = error; }
    finally { Object.defineProperty(owner, 'delete', descriptor); }
    assert(intercepted, '未拦截实际 cursor.delete，测试故障注入无效');
    assert(interrupted, '未在事件删除成功后触发预设的事务中断');
    assert(didReject, '事务中断后删除应失败');
    equal(await get(ids.rollback), before, '事务中断后元数据没有恢复');
    equal(await events(ids.rollback), beforeEvents, '事务中断后事件没有恢复');
    equal(await events(ids.preserved), keepEventsBefore, '事务中断影响了其他记录');
    assert(typeof failure?.message === 'string' && failure.message.length > 0, '删除失败必须返回可显示的错误说明');
  });
} catch (error) {
  await test('测试初始化', async () => { throw error; });
} finally {
  await test('清理本次 UUID 前缀的全部合成数据，不访问其他记录', async () => {
    for (const id of owned) {
      const record = await get(id);
      if (record) {
        if (record.active) { record.active = false; record.status = 'stopped'; await sessionDB.put(record); }
        await remove(id);
      }
      assert(await get(id) === undefined, '合成元数据未清理');
      equal(await events(id), [], '合成事件未清理');
    }
  });
}
document.getElementById('progress').textContent = failures ? `${passed} 项通过，${failures} 项失败。` : `全部 ${passed} 项测试通过；本次合成记录已清理。`;
document.title = failures ? `FAIL · ${failures} history database tests` : `PASS · ${passed} history database tests`;
