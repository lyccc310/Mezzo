// ✅ 正確
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // NVR 代理
      '/nvr': {
        target: 'http://220.135.209.219:8088',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nvr/, ''),
      },
      // HLS 串流代理
      '/streams': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      // API 代理（如果需要）
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});