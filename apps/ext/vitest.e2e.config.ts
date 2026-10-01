import { defineConfig } from "vitest/config";

/**
 * Testes E2E: sobem o Chromium real com a extensão carregada (build em ./dist).
 * Por padrão abre a janela (headless: false) para você VER o side panel rodando.
 *
 *   pnpm --filter @apps/ext test:e2e
 */
export default defineConfig({
  test: {
    environment: "web-ext",
    environmentOptions: {
      "web-ext": {
        path: "./dist",
        autoLaunch: true,
        detectExtensionId: true,
        targetUrl: "https://www.example.com",
        detectTimeout: 20_000,
        playwright: {
          headless: false,
          slowMo: 80,
          devtools: false,
        },
      },
    },
    include: ["e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
