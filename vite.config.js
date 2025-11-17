// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 打到 /nvr 的請求，都會被轉到 220.135.209.219:8088
      '/nvr': {
        target: 'http://220.135.209.219:8088',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nvr/, ''),
      },
    },
  },
});
