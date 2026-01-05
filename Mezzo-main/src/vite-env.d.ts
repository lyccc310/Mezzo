/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
  readonly DEV: boolean;
  // 加入其他你使用的環境變數...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}