export type ZipSink = {
  readonly name: string;
  write(stream: ReadableStream<Uint8Array>): Promise<void>;
  abort(): Promise<void>;
};

export type FileHandleLike = {
  readonly name: string;
  createWritable(): Promise<WritableStream<Uint8Array>>;
};

export type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike>;

function getSaveFilePicker(): SaveFilePicker | null {
  const candidate = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof candidate === "function" ? (candidate as SaveFilePicker) : null;
}

/** Se o navegador permite gravar direto no disco (streaming, sem estourar RAM). */
export function canUseFileSystemAccess(): boolean {
  return getSaveFilePicker() !== null && typeof document !== "undefined";
}

/**
 * Cria um destino a partir de um handle já existente (ex.: recuperado do
 * IndexedDB pelo documento offscreen). Pode lançar se a permissão de escrita
 * não valer mais — o chamador decide o fallback.
 */
export async function sinkFromFileHandle(handle: FileHandleLike): Promise<ZipSink> {
  const writable = await handle.createWritable();

  return {
    name: handle.name,
    async write(stream) {
      await stream.pipeTo(writable);
    },
    async abort() {
      await writable.abort().catch(() => {});
    },
  };
}

/**
 * Prepara o destino do ZIP **antes** do download. Precisa ser chamado no gesto
 * do usuário (clique) para o seletor de arquivo funcionar.
 */
export async function prepareZipSink(suggestedName: string): Promise<ZipSink> {
  const picker = getSaveFilePicker();

  if (picker && typeof document !== "undefined") {
    const handle = await picker({
      suggestedName,
      types: [{ description: "Arquivo ZIP", accept: { "application/zip": [".zip"] } }],
    });
    const writable = await handle.createWritable();

    return {
      name: handle.name,
      async write(stream) {
        await stream.pipeTo(writable);
      },
      async abort() {
        await writable.abort().catch(() => {});
      },
    };
  }

  return {
    name: suggestedName,
    async write(stream) {
      triggerDownload(await new Response(stream).blob(), suggestedName);
    },
    async abort() {
      // nada a descartar
    },
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Nome sugerido do arquivo (`media-pack-2026-01-01T12-00-00.zip`). */
export function buildZipName(prefix = "media-pack", date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}-${stamp}.zip`;
}
