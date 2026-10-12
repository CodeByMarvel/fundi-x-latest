import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens the database and brings it up to date with every migration.
 *
 * Development uses PGlite: real PostgreSQL running inside Node, so there's
 * nothing to install. `dataDir` keeps the data on disk between restarts;
 * leaving it out gives a fresh in-memory database (used by tests). In
 * production this becomes a connection to a PostgreSQL server; the queries
 * stay the same.
 */
export async function createDatabase({ dataDir }: { dataDir?: string } = {}) {
  if (dataDir) {
    // PGlite creates only the last folder; make sure the rest exist.
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}

export type Database = Awaited<ReturnType<typeof createDatabase>>['db'];
/** A database handle inside a transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
