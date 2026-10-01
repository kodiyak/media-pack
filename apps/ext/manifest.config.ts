import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Media Pack",
  version: "0.0.0",
  description: "Colete mídias de qualquer página e organize em packs.",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  action: {
    default_title: "Abrir Media Pack",
  },
  side_panel: {
    default_path: "sidepanel.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage", "activeTab", "scripting", "sidePanel"],
  host_permissions: ["http://*/*", "https://*/*"],
});
