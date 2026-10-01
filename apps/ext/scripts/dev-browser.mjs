#!/usr/bin/env node
/**
 * Sobe o Vite (CRXJS dev) e abre um Chromium novo JÁ com a extensão carregada,
 * com a página do side panel aberta em uma aba (com HMR).
 *
 *   pnpm --filter @apps/ext dev:ext
 *
 * O painel lateral "docked" do Chrome não pode ser aberto por script (exige um
 * gesto do usuário). Dê 1 clique no ícone da extensão para encaixá-lo — depois
 * disso ele também reflete o HMR.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(appDir);

const distDir = path.join(appDir, "dist");
const manifestPath = path.join(distDir, "manifest.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForManifest(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(manifestPath)) return;
    await sleep(200);
  }
  throw new Error(`Não encontrei ${manifestPath} em ${timeoutMs}ms.`);
}

let server;
let context;
let profileDir;
let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await context?.close();
  } catch {
    // ignore
  }

  try {
    await server?.close();
  } catch {
    // ignore
  }

  if (profileDir) {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }

  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

// 0. Limpa o build anterior para garantir que o manifest detectado é o de dev.
await rm(distDir, { recursive: true, force: true });

// 1. Sobe o Vite/CRXJS (porta 5173, garantida por strictPort).
server = await createServer({ configFile: path.join(appDir, "vite.config.ts") });
await server.listen();
const devUrl = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";
console.log(`\n[dev:ext] Vite (CRXJS) em ${devUrl}`);

// 2. Espera a extensão de dev ser escrita em ./dist.
console.log("[dev:ext] aguardando dist/manifest.json...");
await waitForManifest(30_000);

// 3. Abre o Chromium com a extensão carregada.
console.log("[dev:ext] abrindo o Chromium com a extensão...");
profileDir = await mkdtemp(path.join(tmpdir(), "media-pack-dev-"));
context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

// 4. Descobre o id da extensão pelo service worker.
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker", { timeout: 20_000 });
const extensionId = new URL(worker.url()).host;
console.log(`[dev:ext] extensão carregada (id: ${extensionId})`);

// 5. Abre a página do side panel (mesmo arquivo do manifest) com HMR.
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
console.log("[dev:ext] side panel aberto em uma aba (com HMR).");
console.log("[dev:ext] Clique no ícone da extensão para abrir o painel lateral docked.");
console.log("[dev:ext] Edite os arquivos e veja refletir. Feche o navegador para encerrar.\n");

context.on("close", () => void shutdown(0));

// 6. Smoketest opcional: encerra sozinho após N ms.
const exitAfter = Number(process.env.DEV_EXT_EXIT_AFTER_MS ?? 0);
if (exitAfter > 0) {
  setTimeout(() => void shutdown(0), exitAfter);
}

await new Promise(() => {});
