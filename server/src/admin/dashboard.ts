import { and, eq, gte, notInArray, sql } from 'drizzle-orm';
import { LATE_GRACE_MS } from '../../../src/domain/jobs/rules';
import type { FastifyInstance } from 'fastify';
import { isTerminalStatus } from '../../../src/domain/jobs/transitions';
import type { Database } from '../db/client';
import { jobs, providers, refunds, transfers } from '../db/schema';
import { getSetting } from '../settings';
import { systemNumbers } from './engineering';
import { JOB_STATUSES } from './jobs';
import { can } from './permissions';
import { staffOf } from './session';
import { heldInEscrowSql } from './support';

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year, no DST

/** Midnight today in Nairobi, as a moment in time. */
export function startOfNairobiDay(now = new Date()) {
  const local = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - NAIROBI_OFFSET_MS);
}

const FINISHED = JOB_STATUSES.filter(isTerminalStatus);

/**
 * "What is happening in Fundi-X right now?" (docs/admin-portal.md §3.1).
 * One call; each part is included only if the caller may see the section
 * behind it.
 */
export function registerAdminDashboard(admin: FastifyInstance, db: Database) {
  admin.get('/dashboard', async request => {
    const me = await staffOf(db, request);
    const result: Record<string, unknown> = {};

    if (can(me.role, 'logs.view')) {
      result.system = await systemNumbers(db);
    }
    if (can(me.role, 'jobs.view')) {
      const byStatus = await db
        .select({ status: jobs.status, count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(notInArray(jobs.status, FINISHED))
        .groupBy(jobs.status);
      const today = startOfNairobiDay();
      // Only jobs touched today can count. A finished job never changes
      // again, so a CANCELLED one touched today was cancelled today.
      const [counts] = await db
        .select({
          created: sql<number>`count(*) filter (where ${jobs.createdAt} >= ${today})::int`,
          completed: sql<number>`count(*) filter (where ${jobs.status} = 'COMPLETED' and ${jobs.completedAt} >= ${today})::int`,
          cancelled: sql<number>`count(*) filter (where ${jobs.status} = 'CANCELLED')::int`,
        })
        .from(jobs)
        .where(gte(jobs.updatedAt, today));
      // Past the promised arrival + grace and still driving: the customer
      // may cancel with a refund, and support should check in
      // (job-flow.md §10, "not-arrived alert").
      const lateBefore = new Date(Date.now() - LATE_GRACE_MS).toISOString();
      const [late] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            eq(jobs.status, 'EN_ROUTE'),
            sql`(${jobs.extra}->>'expectedArrivalAt')::timestamptz < ${lateBefore}`,
          ),
        );
      result.jobs = {
        active: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
        today: counts,
        lateArrivals: late.count,
        // Customers waiting on Fundi-X support.
        openDisputes: byStatus.find(r => r.status === 'DISPUTED')?.count ?? 0,
      };
    }
    if (can(me.role, 'users.view')) {
      const [pending] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(providers)
        .where(eq(providers.verification, 'PENDING'));
      result.mechanics = { awaitingVerification: pending.count };
    }
    if (can(me.role, 'money.view')) {
      const [[held], [waiting]] = await Promise.all([
        db
          .select({ amount: sql<number>`coalesce(sum(${heldInEscrowSql}), 0)::bigint`.mapWith(Number) })
          .from(jobs),
        db
          .select({
            count: sql<number>`count(*)::int`,
            amount: sql<number>`coalesce(sum(${refunds.amount}), 0)::bigint`.mapWith(Number),
          })
          .from(refunds)
          .where(eq(refunds.status, 'PENDING')),
      ]);
      const [failed] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(transfers)
        .where(eq(transfers.status, 'FAILED'));
      result.money = { heldInEscrow: held.amount, refundsWaiting: waiting, transfersFailed: failed.count };
    }
    if (can(me.role, 'settings.edit')) {
      result.settings = { callOutFee: await getSetting(db, 'call_out_fee') };
    }
    return result;
  });
}
