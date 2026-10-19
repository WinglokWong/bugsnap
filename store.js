const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('bugsnap', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('reports', { keyPath: 'id' });
    request.result.createObjectStore('drafts');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function store(name, operation, value, key) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, ['get', 'getAll'].includes(operation) ? 'readonly' : 'readwrite');
    const object = tx.objectStore(name);
    const request = operation === 'getAll' ? object.getAll() : key === undefined ? object[operation](value) : object[operation](value, key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('本地存储写入失败'));
  });
}
