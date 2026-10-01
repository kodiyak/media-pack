/**
 * Guarda o `FileSystemFileHandle` escolhido no side panel para que o documento
 * offscreen (que faz o download) consiga gravar direto no arquivo mesmo que o
 * painel tenha sido fechado no meio. Side panel e offscreen compartilham o
 * mesmo IndexedDB por serem da mesma origem (`chrome-extension://<id>`).
 */

const DB_NAME = "media-pack";
const DB_VERSION = 1;
const STORE = "handles";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não está disponível."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o IndexedDB."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error("Falha no IndexedDB."));
      tx.onabort = () => reject(tx.error ?? new Error("Transação abortada."));
    });
  } finally {
    db.close();
  }
}

/** `true` quando dá para usar o IndexedDB (fallback do offscreen é o OPFS). */
export function hasHandleStore(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function saveFileHandle(jobId: string, handle: FileSystemFileHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, jobId));
}

export async function loadFileHandle(jobId: string): Promise<FileSystemFileHandle | null> {
  const value = await withStore<FileSystemFileHandle | undefined>("readonly", (store) =>
    store.get(jobId),
  );
  return value ?? null;
}

export async function deleteFileHandle(jobId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(jobId));
}
