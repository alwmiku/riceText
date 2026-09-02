/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ROOT?: string;
  readonly VITE_DEMO_AUTH?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
