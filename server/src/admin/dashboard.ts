import { gte, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { isTerminalStatus } from '../../../src/domain/jobs/transitions';
import type { Database } from '../db/client';
import { jobs } from '../db/schema';
import { getSetting } from '../settings';
import { systemNumbers } from './engineering';
import { JOB_STATUSES } from './jobs';
import { can } from './permissions';
import { staffOf } from './session';

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
      result.jobs = {
        active: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
        today: counts,
      };
    }
    if (can(me.role, 'settings.edit')) {
      result.settings = { callOutFee: await getSetting(db, 'call_out_fee') };
    }
    return result;
  });
}
