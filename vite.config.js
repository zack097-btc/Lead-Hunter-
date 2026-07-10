import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `vercel dev`, the API and frontend are served together on one port,
// so no proxy is needed. The proxy below only matters if you run `vite` alone
// (npm run dev:web) while a separate API server runs on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist'
  }
});
