#!/usr/bin/env node
/**
 * Auto-reload da extensão carregada localmente.
 *
 *   pnpm --filter @apps/ext dev:watch      (ou `pnpm dev:watch` na raiz)
 *
 * Roda `vite build --watch` e serve um WebSocket. A cada build concluído o
 * script manda "reload" e o service worker da extensão chama
 * `chrome.runtime.reload()` sozinho.
 *
 * Primeira vez (o build atual ainda não tem o cliente de auto-reload):
 *   1. rode este script e espere o primeiro build;
 *   2. recarregue a extensão UMA vez em chrome://extensions (↻);
 *   3. daí em diante as alterações se recarregam sozinhas.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { WebSocketServer } from "ws";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(appDir);
process.env.VITE_EXT_AUTO_RELOAD = "1";

const PORT = 35729;
const HEARTBEAT_MS = 20_000;
const RELOAD_DELAY_MS = 300;

let pendingReload = false;
const server = new WebSocketServer({ port: PORT });

function broadcastReload() {
  let delivered = false;
  for (const client of server.clients) {
    if (client.readyState === client.OPEN) {
      client.send("reload");
      delivered = true;
    }
  }
  pendingReload = !delivered;
  console.log(
    delivered
      ? "[dev:watch] alteração detectada → recarregando a extensão"
      : "[dev:watch] alteração detectada → reload pendente (extensão dormindo)",
  );
}

server.on("connection", (socket) => {
  console.log("[dev:watch] extensão conectada");
  // Se um build aconteceu enquanto o service worker estava suspenso,
  // recarrega assim que ele reconectar.
  if (pendingReload) {
    socket.send("reload");
    pendingReload = false;
  }
});

server.on("listening", () => console.log(`[dev:watch] WebSocket em ws://localhost:${PORT}`));
server.on("error", (error) => console.error("[dev:watch] erro no WebSocket:", error.message));

// O service worker do MV3 é suspenso por inatividade; o ping o mantém vivo.
const heartbeat = setInterval(() => {
  for (const client of server.clients) {
    if (client.readyState === client.OPEN) client.send("ping");
  }
}, HEARTBEAT_MS);
server.on("close", () => clearInterval(heartbeat));

const watcher = await build({
  configFile: path.join(appDir, "vite.config.ts"),
  build: { watch: {} },
  define: {
    "import.meta.env.VITE_EXT_AUTO_RELOAD": JSON.stringify("1"),
  },
});

watcher.on("event", (event) => {
  if (event.code === "END") {
    pendingReload = true;
    setTimeout(broadcastReload, RELOAD_DELAY_MS);
  } else if (event.code === "ERROR") {
    console.error("[dev:watch] erro no build:", event.error);
  }
});

console.log("[dev:watch] observando alterações (Ctrl+C para sair)");
