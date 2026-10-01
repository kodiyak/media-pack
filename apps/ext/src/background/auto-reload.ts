/**
 * Cliente de auto-reload (apenas desenvolvimento).
 *
 * Fica inativo a menos que o build tenha sido feito com
 * `VITE_EXT_AUTO_RELOAD=1` — o script `scripts/watch.mjs` faz isso. Nesse modo
 * a extensão conversa com um WebSocket local e recarrega sozinha a cada build.
 */
const PORT = 35729;
const RECONNECT_DELAY_MS = 3_000;

export function startAutoReload(): void {
  if (import.meta.env.VITE_EXT_AUTO_RELOAD !== "1") return;
  if (typeof WebSocket === "undefined") return;
  connect();
}

function connect(): void {
  let socket: WebSocket;
  try {
    socket = new WebSocket(`ws://localhost:${PORT}`);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener("message", (event: MessageEvent) => {
    if (event.data === "reload") {
      console.log("[media-pack] reload de dev: recarregando a extensão…");
      chrome.runtime.reload();
    }
  });
  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", () => socket.close());
}

function scheduleReconnect(): void {
  setTimeout(connect, RECONNECT_DELAY_MS);
}
