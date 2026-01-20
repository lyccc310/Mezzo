import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',  // ← 
    port: 5173,
    proxy: {
      '/nvr': {
        target: 'http://220.135.209.219:8088',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nvr/, ''),
      },
      '/streams': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});