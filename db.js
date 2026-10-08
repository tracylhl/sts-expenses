// On-phone store (IndexedDB) for expenses and their receipt photos.
// Each expense has status: 'queued' (waiting to sync), 'synced', or 'error'.
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const req = indexedDB.open('sts-expenses', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('expenses', { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('expenses', mode);
      const out = fn(t.objectStore('expenses'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    put: (exp) => tx('readwrite', (s) => s.put(exp)),
    get: (id) => tx('readonly', (s) => s.get(id)),
    all: () => tx('readonly', (s) => s.getAll()),
  };
})();
