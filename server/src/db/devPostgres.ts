import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

/**
 * DEVELOPMENT ONLY: a real PostgreSQL 17 server from npm, for the laptop.
 *
 * It runs as its own process, separate from the API server, so reloading
 * the API on every code change never touches the data, and PostgreSQL's
 * write-ahead log recovers cleanly even from a hard stop. The address,
 * user and password come from DATABASE_URL in server/.env; the files live
 * in server/data/postgres (never committed).
 */

const DATA_DIR = resolve(process.env.PG_DATA_DIR ?? './data/postgres');

/** True if a PostgreSQL server already answers at this address. */
async function answers(url: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure the development database is running. Starts it (creating it
 * on first use) unless one already answers, e.g. left running by an
 * earlier session. Returns `stop`, which only stops a server it started.
 */
export async function startDevPostgres(databaseUrl: string, log = console.log) {
  if (await answers(databaseUrl)) {
    log('PostgreSQL is already running; using it.');
    return { stop: async () => {} };
  }

  const url = new URL(databaseUrl);
  const database = url.pathname.slice(1);
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port || 5432),
    persistent: true,
    onLog: () => {}, // PostgreSQL is chatty; errors still come through onError
    onError: message => console.error('[postgres]', message),
  });

  const firstRun = !existsSync(DATA_DIR);
  if (firstRun) {
    log(`Creating the development database in ${DATA_DIR} (first run only)…`);
    await server.initialise();
  }
  await server.start();
  if (firstRun) {
    await server.createDatabase(database);
  }
  log(`PostgreSQL 17 is running on port ${url.port || 5432}.`);
  return { stop: () => server.stop() };
}
