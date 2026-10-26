import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Shown in the footer as "Last updated".
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true } },
  },
});
