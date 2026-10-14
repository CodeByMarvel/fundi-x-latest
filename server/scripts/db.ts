import { existsSync } from 'node:fs';
import { startDevPostgres } from '../src/db/devPostgres';

/** `npm run db`: only the development database, until Ctrl+C. */

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing from server/.env (see .env.example).');
  process.exit(1);
}
const database = await startDevPostgres(process.env.DATABASE_URL);
console.log('Press Ctrl+C to stop it.');
process.on('SIGINT', async () => {
  await database.stop();
  process.exit(0);
});
