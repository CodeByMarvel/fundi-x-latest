import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows;

/**
 * Checks the books against the money records (docs/ledger.md §4). On a
 * healthy system every list is empty and the total is zero. Run by the
 * admin portal; anything found is a bug to investigate, never something
 * to "fix" by editing rows.
 */
export async function checkBooks(db: Database) {
  const [total] = rows(
    await db.execute(sql`select coalesce(sum(amount), 0)::bigint as total from ledger_lines`),
  );

  // Each job's escrow account must hold exactly what the records say:
  // paid in, minus refunded, minus paid out.
  const escrow = rows(
    await db.execute(sql`
      with records as (
        select j.id as job_id,
          coalesce((select sum(p.amount) from payments p where p.job_id = j.id and p.status = 'SUCCESS'), 0)
          - coalesce((select sum(r.amount) from refunds r where r.job_id = j.id), 0)
          - coalesce((select sum(l.gross) from releases l where l.job_id = j.id), 0) as held
        from jobs j
      ),
      books as (
        select substring(account from 8) as job_id, -sum(amount) as held
        from ledger_lines where account like 'escrow:%' group by 1
      )
      select coalesce(r.job_id, b.job_id) as job_id,
             coalesce(r.held, 0)::bigint as records, coalesce(b.held, 0)::bigint as books
      from records r full join books b on b.job_id = r.job_id
      where coalesce(r.held, 0) <> coalesce(b.held, 0)
      limit 100`),
  );

  // Every money record must have its entry.
  const missing = rows(
    await db.execute(sql`
      select 'payment' as kind, p.id from payments p
        where p.status = 'SUCCESS' and not exists (select 1 from ledger_entries e where e.payment_id = p.id and e.kind = 'PAYMENT_RECEIVED')
      union all
      select 'release', r.id from releases r
        where not exists (select 1 from ledger_entries e where e.release_id = r.id and e.kind = 'RELEASE')
      union all
      select 'refund', f.id from refunds f
        where not exists (select 1 from ledger_entries e where e.refund_id = f.id and e.kind = 'REFUND')
      limit 100`),
  );

  // Nothing owed may go below zero (paying a mechanic more than they earned).
  const overdrawn = rows(
    await db.execute(sql`
      select account, sum(amount)::bigint as balance from ledger_lines
      where account like 'escrow:%' or account like 'provider:%' or account like 'customer:%'
      group by account having sum(amount) > 0
      limit 100`),
  );

  const result = {
    total: Number(total.total),
    escrowMismatches: escrow.map(r => ({ jobId: String(r.job_id), records: Number(r.records), books: Number(r.books) })),
    missingEntries: missing.map(r => ({ kind: String(r.kind), id: String(r.id) })),
    overdrawn: overdrawn.map(r => ({ account: String(r.account), balance: Number(r.balance) })),
  };
  return {
    ...result,
    ok:
      result.total === 0 &&
      result.escrowMismatches.length === 0 &&
      result.missingEntries.length === 0 &&
      result.overdrawn.length === 0,
  };
}

/** Balances by kind of account, for the Finance page. */
export async function bookTotals(db: Database) {
  const [row] = rows(
    await db.execute(sql`
      select
        coalesce(sum(amount) filter (where account = 'mpesa'), 0)::bigint as mpesa,
        coalesce(-sum(amount) filter (where account like 'escrow:%'), 0)::bigint as escrow,
        coalesce(-sum(amount) filter (where account like 'provider:%'), 0)::bigint as owed_to_mechanics,
        coalesce(-sum(amount) filter (where account like 'customer:%'), 0)::bigint as owed_to_customers,
        coalesce(-sum(amount) filter (where account like 'revenue:%'), 0)::bigint as revenue
      from ledger_lines`),
  );
  return {
    mpesa: Number(row.mpesa),
    escrow: Number(row.escrow),
    owedToMechanics: Number(row.owed_to_mechanics),
    owedToCustomers: Number(row.owed_to_customers),
    revenue: Number(row.revenue),
  };
}
