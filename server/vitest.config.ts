import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The app's server client (test/app-client.test.ts) reads its server
    // address from '@env', which only exists in the app's bundler.
    alias: { '@env': fileURLToPath(new URL('./test/envStub.ts', import.meta.url)) },
  },
  test: {
    // The first PGlite start loads PostgreSQL itself and can take a while.
    hookTimeout: 60_000,
  },
});
