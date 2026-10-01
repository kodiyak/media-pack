import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Dev server "só UI": roda o side panel como uma página comum, sem carregar
 * a extensão no Chrome. Serve para ver/iterar nos componentes rapidinho.
 *
 *   pnpm --filter @apps/ext dev:ui
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    open: "/sidepanel.html",
  },
});
