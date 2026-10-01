import { type ExtensionMessage, mediaItemSchema } from "@repo/protocol";

function send(message: ExtensionMessage): void {
  // Em algumas páginas (ex.: chrome://) o runtime não está disponível.
  if (!chrome.runtime?.id) return;
  void chrome.runtime.sendMessage(message);
}

function collectImages(): void {
  const images = Array.from(document.images);

  for (const image of images) {
    const url = image.currentSrc || image.src;
    if (!url) continue;

    const parsed = mediaItemSchema.safeParse({
      id: crypto.randomUUID(),
      url,
      kind: "image",
      filename: image.alt || undefined,
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
      sourceUrl: location.href,
      pageTitle: document.title,
      createdAt: new Date().toISOString(),
    });

    if (!parsed.success) continue;

    send({ type: "media:collected", payload: parsed.data });
  }
}

collectImages();
