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
 * Grava o stream do ZIP direto no arquivo escolhido pelo usuário.
 * Precisa ser chamado a partir de um gesto do usuário (clique).
 */
export async function saveStreamWithPicker(
  stream: ReadableStream<Uint8Array>,
  suggestedName: string,
): Promise<string> {
  const picker = getSaveFilePicker();
  if (!picker) {
    throw new Error("Seu navegador não suporta gravar em disco (File System Access API).");
  }

  const handle = await picker({
    suggestedName,
    types: [{ description: "Arquivo ZIP", accept: { "application/zip": [".zip"] } }],
  });

  const writable = await handle.createWritable();
  await stream.pipeTo(writable);
  return handle.name;
}

/** Fallback: buffferiza o ZIP na memória e dispara o download via `<a>`. */
export async function saveStreamAsBlob(
  stream: ReadableStream<Uint8Array>,
  filename: string,
): Promise<void> {
  const blob = await new Response(stream).blob();
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
