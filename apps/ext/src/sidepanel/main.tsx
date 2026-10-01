import { ThemeProvider } from "@repo/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "../index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Elemento #root não encontrado no documento.");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="media-pack-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
