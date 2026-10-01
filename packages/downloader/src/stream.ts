/** Envolve um stream contando os bytes que passam por ele. */
export function countBytes(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunkBytes: number) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
      onChunk(value.byteLength);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export function parseContentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
