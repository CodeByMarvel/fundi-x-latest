import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startDevPostgres } from '../src/db/devPostgres';

/**
 * `npm run dev`: starts the development database, then the API server in
 * watch mode. The watcher restarts only the API server on code changes;
 * the database keeps running underneath. Ctrl+C stops both, database last.
 */

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is missing from server/.env (see .env.example).');
  process.exit(1);
}

const database = await startDevPostgres(databaseUrl);

const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const api = spawn(process.execPath, [tsx, 'watch', 'src/index.ts'], { stdio: 'inherit' });

let stopping = false;
async function stop(code = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  api.kill();
  await database.stop();
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
api.on('exit', code => stop(code ?? 0));
