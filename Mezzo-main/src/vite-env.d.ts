/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_BACKEND_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_SIGNALING_URL: string;
  readonly VITE_NVR_HOST: string;
  readonly VITE_NVR_AUTH: string;
  readonly VITE_BWC_STREAM_URL: string;
  readonly VITE_BWC_STREAM_AUTH: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_COGNITO_REGION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}