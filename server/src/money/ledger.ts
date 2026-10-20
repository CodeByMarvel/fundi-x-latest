import { eq, sql } from 'drizzle-orm';
import type { MoneyPurpose } from '../../../src/domain/billing/types';
import type { Cents } from '../../../src/domain/money';
import type { Database, Tx } from '../db/client';
import { type LedgerEntryKind, ledgerEntries, ledgerLines } from '../db/schema';
import { newId } from '../ids';

/**
 * The double-entry ledger (docs/ledger.md). Every money event is one entry
 * whose lines add up to zero: money moves between accounts, never appears
 * or disappears. Debits are positive, credits negative.
 *
 *   mpesa             asset: money Fundi-X holds at Safaricom
 *   escrow:<jobId>    owed: held for one job
 *   provider:<id>     owed: earned by a mechanic, not yet sent
 *   customer:<id>     owed: refunds not yet sent
 *   revenue:<purpose> Fundi-X's commission
 *
 * An owed account's balance is negative (a credit) while something is
 * owed; `owed()` flips the sign so screens show positive amounts.
 */
export const account = {
  mpesa: 'mpesa',
  escrow: (jobId: string) => `escrow:${jobId}`,
  provider: (userId: string) => `provider:${userId}`,
  customer: (userId: string) => `customer:${userId}`,
  revenue: (purpose: MoneyPurpose) => `revenue:${purpose}`,
};

export type LedgerLine = { account: string; amount: Cents };

export type EntryRefs = {
  jobId?: string | null;
  paymentId?: string;
  refundId?: string;
  releaseId?: string;
  transferId?: string;
};

export class UnbalancedEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnbalancedEntryError';
  }
}

/**
 * Records one entry. Checked here so a mistake fails with a clear message
 * before touching the database; the database checks again at commit
 * (drizzle/0012_ledger_rules.sql).
 */
export async function post(
  tx: Tx,
  kind: LedgerEntryKind,
  description: string,
  refs: EntryRefs,
  lines: LedgerLine[],
  at: Date,
) {
  const kept = lines.filter(l => l.amount !== 0);
  if (kept.length < 2) {
    throw new UnbalancedEntryError(`${kind}: an entry needs at least two non-zero lines`);
  }
  if (kept.some(l => !Number.isInteger(l.amount))) {
    throw new UnbalancedEntryError(`${kind}: amounts must be whole cents`);
  }
  const total = kept.reduce((s, l) => s + l.amount, 0);
  if (total !== 0) {
    throw new UnbalancedEntryError(`${kind}: lines add up to ${total}, not 0`);
  }
  const id = newId('led');
  await tx.insert(ledgerEntries).values({
    id,
    kind,
    jobId: refs.jobId ?? null,
    paymentId: refs.paymentId ?? null,
    refundId: refs.refundId ?? null,
    releaseId: refs.releaseId ?? null,
    transferId: refs.transferId ?? null,
    description,
    createdAt: at,
  });
  await tx.insert(ledgerLines).values(
    kept.map(l => ({ id: newId('ll'), entryId: id, account: l.account, amount: l.amount, createdAt: at })),
  );
  return id;
}

/** An account's balance: debits minus credits. */
export async function balance(db: Database | Tx, name: string): Promise<Cents> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${ledgerLines.amount}), 0)::bigint`.mapWith(Number) })
    .from(ledgerLines)
    .where(eq(ledgerLines.account, name));
  return row.total;
}

/** What an owed account (escrow, provider, customer) is owed, as a positive number. */
export const owed = async (db: Database | Tx, name: string) => -(await balance(db, name));
