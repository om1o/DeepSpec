/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute origin for `/api`, e.g. when hosting static frontend separately */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
