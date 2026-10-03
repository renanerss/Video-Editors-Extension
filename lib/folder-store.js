// Guarda a pasta de destino escolhida pelo usuário (FileSystemDirectoryHandle) no IndexedDB.
// Handles não cabem em chrome.storage, mas o IndexedDB os aceita e é compartilhado entre
// popup, página de opções e offscreen document (mesma origem da extensão).
const FolderStore = (() => {
  const DB = "scroll-recorder", STORE = "kv", KEY = "folder";
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  };
  return {
    save: (handle) => run("readwrite", (s) => s.put(handle, KEY)),
    load: async () => (await run("readonly", (s) => s.get(KEY))) ?? null,
    clear: () => run("readwrite", (s) => s.delete(KEY)),
  };
})();
