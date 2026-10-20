import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import { jobs, payments, providers, refunds, releases, users } from '../db/schema';
import { bookTotals, checkBooks } from '../money/check';
import { startOfNairobiDay } from './dashboard';
import { staffOf } from './session';
import { heldInEscrowSql } from './support';

const DAY_MS = 86_400_000;

/** A date (YYYY-MM-DD, Nairobi) as the moment that day starts. */
const nairobiDay = (date: string) => new Date(`${date}T00:00:00+03:00`);

const range = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;

/** The period asked for: `from` to the end of `to` (Nairobi days); 30 days by default. */
function period(query: { from?: string; to?: string }) {
  const end = query.to ? new Date(nairobiDay(query.to).getTime() + DAY_MS) : new Date();
  const start = query.from
    ? nairobiDay(query.from)
    : new Date(startOfNairobiDay(end).getTime() - 29 * DAY_MS);
  return { start, end };
}

const sumCents = (column: unknown) =>
  sql<number>`coalesce(sum(${column}), 0)::bigint`.mapWith(Number);

/**
 * Finance (docs/admin-portal.md §3.8), read-only and calculated from the
 * money facts (payments, refunds, releases), never from stored totals.
 * Sending refunds and payouts through M-Pesa comes with Daraja; until then
 * they are "recorded", and this page shows what is waiting to be sent.
 */
export function registerAdminFinance(admin: FastifyInstance, db: Database) {
  /** Totals for a period, plus what is held and owed right now. */
  admin.get<{ Querystring: { from?: string; to?: string } }>(
    '/finance/summary',
    { schema: { querystring: range } },
    async request => {
      await staffOf(db, request, 'money.view');
      const { start, end } = period(request.query);
      const within = (column: typeof payments.updatedAt | typeof refunds.createdAt | typeof releases.createdAt) =>
        and(gte(column, start), lt(column, end));

      const [moneyIn, moneyOut, earned, byDay, [held], [refundsWaiting], [owed]] = await Promise.all([
        // Payments are counted when M-Pesa confirmed them.
        db
          .select({ purpose: payments.purpose, count: sql<number>`count(*)::int`, amount: sumCents(payments.amount), parts: sumCents(payments.partsAmount) })
          .from(payments)
          .where(and(eq(payments.status, 'SUCCESS'), within(payments.updatedAt)))
          .groupBy(payments.purpose),
        db
          .select({ count: sql<number>`count(*)::int`, amount: sumCents(refunds.amount) })
          .from(refunds)
          .where(within(refunds.createdAt)),
        // Fundi-X's earnings: commission per kind of money, from release lines.
        db.execute<{ purpose: string; gross: number; commission: number }>(sql`
          select line->>'purpose' as purpose,
                 sum((line->>'gross')::bigint)::bigint as gross,
                 sum((line->>'commission')::bigint)::bigint as commission
          from ${releases}, jsonb_array_elements(${releases.lines}) as line
          where ${releases.createdAt} >= ${start} and ${releases.createdAt} < ${end}
          group by 1`),
        db.execute<{ day: string; money_in: number; commission: number }>(sql`
          with days as (
            select generate_series(${start}::timestamptz, ${end}::timestamptz - interval '1 microsecond', interval '1 day') as day
          )
          select to_char(days.day at time zone 'Africa/Nairobi', 'YYYY-MM-DD') as day,
            coalesce((select sum(${payments.amount}) from ${payments}
              where ${payments.status} = 'SUCCESS' and ${payments.updatedAt} >= days.day
              and ${payments.updatedAt} < days.day + interval '1 day'), 0)::bigint as money_in,
            coalesce((select sum(${releases.commission}) from ${releases}
              where ${releases.createdAt} >= days.day and ${releases.createdAt} < days.day + interval '1 day'), 0)::bigint as commission
          from days order by days.day`),
        db.select({ amount: sql<number>`coalesce(sum(${heldInEscrowSql}), 0)::bigint`.mapWith(Number), jobs: sql<number>`count(*) filter (where ${heldInEscrowSql} > 0)::int` }).from(jobs),
        db
          .select({ count: sql<number>`count(*)::int`, amount: sumCents(refunds.amount) })
          .from(refunds)
          .where(eq(refunds.status, 'PENDING')),
        db.select({ count: sql<number>`count(*)::int`, amount: sumCents(releases.net) }).from(releases),
      ]);

      // Both drivers (node-postgres, PGlite) return raw queries as { rows }.
      const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows;
      return {
        period: { from: start.toISOString(), to: end.toISOString() },
        moneyIn: moneyIn.map(r => ({ ...r })),
        refunds: moneyOut[0],
        earnings: rows(earned).map(r => ({
          purpose: r.purpose as string,
          gross: Number(r.gross),
          commission: Number(r.commission),
        })),
        byDay: rows(byDay).map(r => ({
          day: r.day as string,
          moneyIn: Number(r.money_in),
          commission: Number(r.commission),
        })),
        now: {
          heldInEscrow: held,
          refundsWaiting,
          // Payouts are recorded at release; sending them (M-Pesa B2C) is
          // not connected yet, so every recorded payout is still owed.
          payoutsRecorded: owed,
        },
      };
    },
  );

  /** Money movements newest first: payments in, refunds and payouts out. */
  admin.get<{ Querystring: { type?: 'payment' | 'refund' | 'release'; before?: string; limit?: number } }>(
    '/finance/transactions',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { enum: ['payment', 'refund', 'release'], default: 'payment' },
            before: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'money.view');
      const { type = 'payment', before, limit = 50 } = request.query;
      if (type === 'payment') {
        return db
          .select()
          .from(payments)
          .where(before ? lt(payments.createdAt, new Date(before)) : undefined)
          .orderBy(desc(payments.createdAt))
          .limit(limit);
      }
      if (type === 'refund') {
        return db
          .select()
          .from(refunds)
          .where(before ? lt(refunds.createdAt, new Date(before)) : undefined)
          .orderBy(desc(refunds.createdAt))
          .limit(limit);
      }
      return db
        .select({
          id: releases.id,
          jobId: releases.jobId,
          providerId: releases.providerId,
          providerName: users.name,
          lines: releases.lines,
          gross: releases.gross,
          commission: releases.commission,
          net: releases.net,
          createdAt: releases.createdAt,
        })
        .from(releases)
        .leftJoin(users, eq(users.id, releases.providerId))
        .where(before ? lt(releases.createdAt, new Date(before)) : undefined)
        .orderBy(desc(releases.createdAt))
        .limit(limit);
    },
  );

  /**
   * The double-entry books: balances by kind of account, and the check
   * that they agree with the money records (docs/ledger.md §4).
   */
  admin.get('/finance/books', async request => {
    await staffOf(db, request, 'money.view');
    const [check, totals] = await Promise.all([checkBooks(db), bookTotals(db)]);
    return { check, totals };
  });

  /** Every job with money still held, oldest first: the longest-held needs a look. */
  admin.get('/finance/escrow', async request => {
    await staffOf(db, request, 'money.view');
    return db
      .select({
        id: jobs.id,
        status: jobs.status,
        request: jobs.request,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        heldInEscrow: heldInEscrowSql,
        customer: { id: users.id, name: users.name },
      })
      .from(jobs)
      .leftJoin(users, eq(users.id, jobs.customerId))
      .where(sql`${heldInEscrowSql} > 0`)
      .orderBy(jobs.createdAt)
      .limit(200);
  });

  /** What each mechanic has earned, with Fundi-X's share. */
  admin.get('/finance/providers', async request => {
    await staffOf(db, request, 'money.view');
    return db
      .select({
        id: users.id,
        name: users.name,
        payoutPhone: providers.payoutPhone,
        payouts: sql<number>`count(${releases.id})::int`,
        gross: sumCents(releases.gross),
        commission: sumCents(releases.commission),
        net: sumCents(releases.net),
        lastAt: sql<string | null>`max(${releases.createdAt})`,
      })
      .from(releases)
      .innerJoin(users, eq(users.id, releases.providerId))
      .innerJoin(providers, eq(providers.userId, releases.providerId))
      .groupBy(users.id, users.name, providers.payoutPhone)
      .orderBy(desc(sql`sum(${releases.net})`))
      .limit(200);
  });
}
