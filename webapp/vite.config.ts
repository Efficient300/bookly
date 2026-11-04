import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Туннель (cloudflared, ngrok) приходит с чужим Host — разрешаем.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
