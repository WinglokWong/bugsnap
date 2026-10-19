let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('bugsnap-sessions', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      const events = request.result.createObjectStore('events', { keyPath: ['sessionId', 'id'] });
      events.createIndex('sessionId', 'sessionId');
      events.createIndex('timeline', ['sessionId', 'order', 'id']);
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return opening;
}
export const sessionDB = {
  async list() { const db = await database(); return new Promise((resolve, reject) => { const r = db.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); },
  async get(id) {
    const db = await database(); return new Promise((resolve, reject) => { const r = db.transaction('sessions').objectStore('sessions').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  },
  async put(session) {
    const db = await database(); return new Promise((resolve, reject) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(session); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  },
  async append(session, event) {
    const db = await database(); return new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite'), events = tx.objectStore('events');
      let added = false; const lookup = events.get([session.id, event.id]);
      lookup.onsuccess = () => {
        if (!lookup.result) {
          added = true;
          events.put({ ...event, sessionId: session.id });
          session.counts[event.category] = (session.counts[event.category] || 0) + 1;
          tx.objectStore('sessions').put(session);
        }
      };
      tx.oncomplete = () => resolve(added); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  },
  async events(id, limits) {
    const db = await database(); return new Promise((resolve, reject) => {
      const tx = db.transaction('events');
      if (!limits) { const r = tx.objectStore('events').index('sessionId').getAll(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); return; }
      const out = [], counts = Object.fromEntries(Object.keys(limits).map(k => [k, 0]));
      const r = tx.objectStore('events').index('timeline').openCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER, '\uffff']), 'prev');
      r.onsuccess = () => {
        const cursor = r.result;
        if (!cursor || Object.keys(counts).every(k => counts[k] >= (limits[k] || 0))) { resolve(out); return; }
        const event = cursor.value;
        if (counts[event.category] < limits[event.category]) { counts[event.category]++; out.push(event); }
        cursor.continue();
      };
      r.onerror = () => reject(r.error);
    });
  },
  async clear(session) {
    const db = await database(); return new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite');
      const cursor = tx.objectStore('events').index('sessionId').openCursor(session.id);
      cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
      tx.objectStore('sessions').put(session); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  },
  async delete(id) {
    const db = await database(); return new Promise((resolve, reject) => {
      // Keep the record and all of its evidence in one transaction so deletion cannot leave orphaned screenshots.
      const tx = db.transaction(['sessions', 'events'], 'readwrite'), sessions = tx.objectStore('sessions');
      let failure;
      const lookup = sessions.get(id);
      lookup.onsuccess = () => {
        if (!lookup.result || lookup.result.active) {
          failure = new Error(lookup.result ? '这条记录还在进行中，请先结束记录，再删除。' : '这条记录已不存在，请刷新列表。');
          tx.abort(); return;
        }
        const cursor = tx.objectStore('events').index('sessionId').openCursor(id);
        cursor.onsuccess = () => { const entry = cursor.result; if (entry) { entry.delete(); entry.continue(); } };
        sessions.delete(id);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(failure || tx.error || new Error('删除未完成，请重试。'));
      tx.onabort = () => reject(failure || tx.error || new Error('删除未完成，请重试。'));
    });
  }
};
