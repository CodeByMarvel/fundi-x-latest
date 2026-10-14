import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzleLite } from 'drizzle-orm/pglite';
import { migrate as migrateLite } from 'drizzle-orm/pglite/migrator';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * The database, whichever kind is behind it. Every query in the server is
 * written against this, so the same code runs on both.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A database handle inside a transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Opens the database and brings it up to date with every migration.
 *
 * - `url`: a PostgreSQL server (DATABASE_URL). Development runs one from
 *   npm (`npm run dev` starts it; see db/devPostgres.ts); production uses a
 *   hosted one. The server process only holds connections, so restarting
 *   it can never damage the data.
 * - no `url`: PGlite, PostgreSQL inside this process, in memory. Used by
 *   tests: each test file gets a fresh, private database. (`dataDir` keeps
 *   it on disk; only the restart tests use that.)
 */
export async function createDatabase({
  url,
  dataDir,
}: { url?: string; dataDir?: string } = {}): Promise<{
  db: Database;
  close: () => Promise<void>;
}> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    // A connection dropped while idle (database restarted, host maintenance)
    // must not crash the server: requests fail until the database is back,
    // then the pool simply opens new connections.
    pool.on('error', err => {
      console.error(`Database connection lost: ${err.message}`);
    });
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Database, close: () => pool.end() };
  }
  if (dataDir) {
    // PGlite creates only the last folder; make sure the rest exist.
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);
  const db = drizzleLite({ client, schema });
  await migrateLite(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Database, close: () => client.close() };
}
