/// <reference types="vite/client" />
/// <reference types="chrome" />

interface ImportMetaEnv {
  /** Ativa o cliente de auto-reload (definido pelo script `dev:watch`). */
  readonly VITE_EXT_AUTO_RELOAD?: string;
}
