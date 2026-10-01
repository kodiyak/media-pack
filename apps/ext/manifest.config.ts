import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Media Pack",
  version: "0.0.0",
  description: "Identifica mídias enquanto as páginas carregam e baixa tudo em um ZIP.",
  minimum_chrome_version: "116",
  icons: {
    "16": "icons/icon-16.webp",
    "32": "icons/icon-32.webp",
    "48": "icons/icon-48.webp",
    "128": "icons/icon-128.webp",
  },
  action: {
    default_title: "Abrir Media Pack",
    default_icon: {
      "16": "icons/icon-16.webp",
      "32": "icons/icon-32.webp",
    },
  },
  side_panel: {
    default_path: "sidepanel.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["storage", "webRequest", "sidePanel", "offscreen"],
  host_permissions: ["http://*/*", "https://*/*"],
});
