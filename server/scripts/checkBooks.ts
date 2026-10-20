import { existsSync } from 'node:fs';
import { createDatabase } from '../src/db/client';
import { bookTotals, checkBooks } from '../src/money/check';

/**
 * `npm run books`: checks the double-entry books against the money
 * records (docs/ledger.md §4) and prints the balances. Read-only.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const { db, close } = await createDatabase({ url: process.env.DATABASE_URL });
const [check, totals] = await Promise.all([checkBooks(db), bookTotals(db)]);
console.log(JSON.stringify({ totals, check }, null, 2));
await close();
process.exit(check.ok ? 0 : 1);
