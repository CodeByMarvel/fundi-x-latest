import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * In development the website and the API look like one site: the page is
 * served on :5173 and anything under /admin (or /health) is passed to the
 * server on :3000. Same site means the session cookie just works.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // the server only accepts changes from this address
    proxy: {
      '/admin': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
