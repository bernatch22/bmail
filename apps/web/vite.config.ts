/**
 * vite.config.ts — Dev server and build config for the BMail SPA.
 *
 * In dev, /api and /ws proxy to the local @bmail/server instance so the
 * cookie-mode client can run same-origin.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      },
    },
  },
});
