import type { DownloadSource } from "./zip";

/** Diretório privado e temporário do Media Pack no OPFS. */
export const OPFS_DIRECTORY = "media-pack-cache";

/** Política padrão: lixo antigo, excesso de arquivos ou excesso de bytes sai. */
export const DEFAULT_OPFS_POLICY = {
  maxAgeMs: 30 * 60 * 1000,
  maxBytes: 1024 * 1024 * 1024,
  maxFiles: 12,
} as const;

export type OpfsPolicy = {
  maxAgeMs?: number;
  maxBytes?: number;
  maxFiles?: number;
};

export type OpfsEntryInfo = {
  name: string;
  sizeBytes: number;
  lastModified: number;
};

/**
 * Decide quais entradas devem ser removidas sem acessar o navegador.
 * Entradas protegidas são arquivos de jobs ainda em uso.
 */
export function selectOpfsEntriesForDeletion(
  entries: OpfsEntryInfo[],
  now = Date.now(),
  policy: OpfsPolicy = {},
  protectedNames: ReadonlySet<string> = new Set(),
): string[] {
  const maxAgeMs = policy.maxAgeMs ?? DEFAULT_OPFS_POLICY.maxAgeMs;
  const maxBytes = policy.maxBytes ?? DEFAULT_OPFS_POLICY.maxBytes;
  const maxFiles = policy.maxFiles ?? DEFAULT_OPFS_POLICY.maxFiles;
  const deletions: string[] = [];
  const remaining = entries
    .filter((entry) => !protectedNames.has(entry.name))
    .sort((left, right) => left.lastModified - right.lastModified);
  const active = new Set(remaining.map((entry) => entry.name));

  for (const entry of remaining) {
    if (now - entry.lastModified > maxAgeMs) {
      deletions.push(entry.name);
      active.delete(entry.name);
    }
  }

  const live = () => remaining.filter((entry) => active.has(entry.name));
  const oldestFirst = live();
  let totalBytes = oldestFirst.reduce((total, entry) => total + entry.sizeBytes, 0);

  for (const entry of oldestFirst) {
    if (live().length <= maxFiles && totalBytes <= maxBytes) break;
    if (!active.has(entry.name)) continue;
    deletions.push(entry.name);
    active.delete(entry.name);
    totalBytes -= entry.sizeBytes;
  }

  return [...new Set(deletions)];
}

export function createOpfsFileName(extension = ".bin"): string {
  const suffix = extension.startsWith(".") ? extension : `.${extension}`;
  return `${Date.now()}-${crypto.randomUUID()}${suffix}`;
}

export async function writeOpfsFile(
  name: string,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<OpfsEntryInfo> {
  const handle = await getOpfsDirectory().then((directory) =>
    directory.getFileHandle(name, { create: true }),
  );
  const writable = await handle.createWritable();

  try {
    await body.pipeTo(writable, { signal });
    const file = await handle.getFile();
    return { name, sizeBytes: file.size, lastModified: file.lastModified };
  } catch (error) {
    await writable.abort().catch(() => {});
    await deleteOpfsFile(name);
    throw error;
  }
}

/** Fonte ZIP que lê um arquivo OPFS e o remove ao terminar de ler. */
export function opfsSource(name: string, filename: string, deleteAfterRead = true): DownloadSource {
  return {
    filename,
    async open() {
      const handle = await getOpfsDirectory().then((directory) => directory.getFileHandle(name));
      const file = await handle.getFile();
      const body = deleteAfterRead
        ? streamWithCleanup(file.stream(), () => deleteOpfsFile(name))
        : file.stream();
      return { body, totalBytes: file.size };
    },
  };
}

export async function deleteOpfsFile(name: string): Promise<void> {
  try {
    const directory = await getOpfsDirectory();
    await directory.removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

/** Limpa lixo antigo e aplica limites de arquivos/bytes. */
export async function cleanupOpfs(
  policy: OpfsPolicy = {},
  protectedNames: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const directory = await getOpfsDirectory();
  const entries: OpfsEntryInfo[] = [];

  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file") continue;
    const file = await handle.getFile();
    entries.push({ name, sizeBytes: file.size, lastModified: file.lastModified });
  }

  const deletions = selectOpfsEntriesForDeletion(entries, Date.now(), policy, protectedNames);
  await Promise.all(deletions.map((name) => deleteOpfsFile(name)));
  return deletions;
}

async function getOpfsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error("OPFS não está disponível neste navegador.");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIRECTORY, { create: true });
}

function streamWithCleanup(
  source: ReadableStream<Uint8Array>,
  cleanup: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let cleaned = false;
  const finish = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await cleanup();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          await finish();
          controller.close();
        } else if (result.value) {
          controller.enqueue(result.value);
        }
      } catch (error) {
        await finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await finish();
    },
  });
}
