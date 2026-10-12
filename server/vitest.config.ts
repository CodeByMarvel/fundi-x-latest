import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The first PGlite start loads PostgreSQL itself and can take a while.
    hookTimeout: 60_000,
  },
});
