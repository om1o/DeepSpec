/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute origin for `/api`, e.g. when hosting static frontend separately */
  readonly VITE_API_BASE_URL?: string;
  /** Supabase URL (project settings). When unset, lookups stay on `localStorage`. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon / publishable key only — never ship `service_role` here */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
