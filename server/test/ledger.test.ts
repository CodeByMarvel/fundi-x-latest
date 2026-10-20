import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { ledgerEntries, ledgerLines } from '../src/db/schema';
import { checkBooks, bookTotals } from '../src/money/check';
import { post, UnbalancedEntryError } from '../src/money/ledger';
import { adminHarness } from './adminHarness';
import { BRIAN, REPAIR, SERVICE, WANJIRU } from './fixtures';

let db: Database;
let close: () => Promise<void>;
let h: ReturnType<typeof adminHarness>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  h = adminHarness(db);
});
beforeEach(() => h.reset());
afterAll(async () => {
  await h.app.close();
  await close();
});

/** Oil change with parts, done; the customer confirms or disputes next. */
async function finishedService() {
  const id = await h.arrived(SERVICE);
  await h.appOk('POST', `/jobs/${id}/ready-to-start`, BRIAN);
  await h.pay(id);
  await h.appOk('POST', `/jobs/${id}/complete`, BRIAN, {});
  return id;
}

describe('the database guards the ledger', () => {
  async function anEntry() {
    return db.transaction(tx =>
      post(tx, 'PAYMENT_RECEIVED', 'test', {}, [
        { account: 'mpesa', amount: 100 },
        { account: 'escrow:x', amount: -100 },
      ], new Date()),
    );
  }

  it('refuses edits and deletes', async () => {
    const id = await anEntry();
    // The database's own message, wrapped by the query library.
    const refused = (e: Error & { cause?: Error }) => /append-only/.test(e.cause?.message ?? e.message);
    await expect(db.update(ledgerLines).set({ amount: 1 }).where(eq(ledgerLines.entryId, id))).rejects.toSatisfy(refused);
    await expect(db.delete(ledgerEntries).where(eq(ledgerEntries.id, id))).rejects.toSatisfy(refused);
  });

  it('refuses an entry that does not balance, even written by hand', async () => {
    await expect(
      db.transaction(tx => post(tx, 'RELEASE', 'bad', {}, [{ account: 'a', amount: 100 }, { account: 'b', amount: -90 }], new Date())),
    ).rejects.toThrow(UnbalancedEntryError);

    // Straight to the tables, past the code's own check: refused at commit.
    await expect(
      db.transaction(async tx => {
        await tx.insert(ledgerEntries).values({ id: 'led_x', kind: 'RELEASE', description: 'x', createdAt: new Date() });
        await tx.insert(ledgerLines).values({ id: 'll_x', entryId: 'led_x', account: 'a', amount: 100, createdAt: new Date() });
      }),
    ).rejects.toThrow(/does not balance/);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, 'led_x'))).toEqual([]);
  });
});

describe('the books follow every job', () => {
  it('a completed job: money in, parts and labour out, commission kept', async () => {
    const id = await finishedService();
    await h.appOk('POST', `/jobs/${id}/confirm`, WANJIRU);

    expect(await bookTotals(db)).toEqual({
      mpesa: 650_000, // call-out 800 + service 5,700, at Safaricom
      escrow: 0,
      owedToMechanics: 650_000 - 56_500, // until M-Pesa B2C sends it
      owedToCustomers: 0,
      revenue: 56_500, // call-out 160 + labour 160 + parts 245
    });
    expect((await checkBooks(db)).ok).toBe(true);

    const detail = await h.staffOk('GET', `/jobs/${id}`);
    expect(detail.ledger.map((e: { kind: string }) => e.kind)).toEqual([
      'PAYMENT_RECEIVED', // call-out
      'PAYMENT_RECEIVED', // service + parts
      'RELEASE', // parts, at once
      'RELEASE', // call-out + labour, on confirmation
    ]);
  });

  it('a cancelled job: the customer is owed the refund', async () => {
    const id = await h.arrived(REPAIR);
    await h.staffOk('POST', `/jobs/${id}/cancel`, { reason: 'Mechanic disappeared' });
    expect(await bookTotals(db)).toMatchObject({ mpesa: 80_000, escrow: 0, owedToCustomers: 80_000 });
    expect((await checkBooks(db)).ok).toBe(true);
  });

  it('a dispute split: refund and payout add up to what was held', async () => {
    const id = await finishedService();
    await h.appOk('POST', `/jobs/${id}/dispute`, WANJIRU, { reason: 'Leaking' });
    await h.staffOk('POST', `/jobs/${id}/resolve-dispute`, {
      outcome: 'SPLIT',
      reason: 'Half the work redone elsewhere',
      customerRefund: 100_000,
      providerPayout: 60_000,
    });
    const totals = await bookTotals(db);
    expect(totals).toMatchObject({ escrow: 0, owedToCustomers: 100_000 });
    expect(totals.mpesa).toBe(totals.owedToCustomers + totals.owedToMechanics + totals.revenue);
    const books = await h.staffOk('GET', '/finance/books');
    expect(books.check).toMatchObject({ ok: true, total: 0 });
  });

  it('notices records written without their ledger entry', async () => {
    await h.arrived(REPAIR);
    // Simulate a bug: a refund row with no entry.
    await db.execute(sql`insert into refunds (id, job_id, payment_id, amount, reason, status, created_at, updated_at)
      select 'ref_bug', job_id, id, 100, 'bug', 'PENDING', now(), now() from payments limit 1`);
    const check = await checkBooks(db);
    expect(check.ok).toBe(false);
    expect(check.missingEntries).toEqual([{ kind: 'refund', id: 'ref_bug' }]);
    expect(check.escrowMismatches).toHaveLength(1);
  });
});

describe('phone verification', () => {
  it('proves the number by a successful payment from it', async () => {
    expect((await h.appOk('GET', '/me', WANJIRU)).phoneVerified).toBe(false);
    await h.arrived(REPAIR);
    expect((await h.appOk('GET', '/me', WANJIRU)).phoneVerified).toBe(true);
  });
});
