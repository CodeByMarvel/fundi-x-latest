import { defineConfig } from 'drizzle-kit';

/**
 * `npm run db:generate` compares src/db/schema.ts with the migrations
 * already in drizzle/ and writes the SQL for whatever changed. Migrations
 * are committed, and applied in order when the server starts.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
