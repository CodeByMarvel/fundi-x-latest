import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import { incidents, timers } from '../db/schema';
import { BadRequestError, NotFoundError } from '../errors';
import { reasonFrom, reasonSchema } from './reason';
import { audit, staffOf } from './session';

/** A PENDING timer this late means the worker isn't keeping up (or stopped). */
export const OVERDUE_AFTER_MS = 2 * 60 * 1000;

const startedAt = Date.now();

/** The numbers the Engineering page and the dashboard's alerts both use. */
export async function systemNumbers(db: Database) {
  const overdueBefore = new Date(Date.now() - OVERDUE_AFTER_MS);
  const [row] = await db
    .select({
      timersPending: sql<number>`count(*) filter (where ${timers.status} = 'PENDING')::int`,
      timersOverdue: sql<number>`count(*) filter (where ${timers.status} = 'PENDING' and ${timers.dueAt} < ${overdueBefore})::int`,
      timersFailed: sql<number>`count(*) filter (where ${timers.status} = 'FAILED')::int`,
    })
    .from(timers);
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(incidents)
    .where(eq(incidents.status, 'OPEN'));
  return { ...row, incidentsOpen: open };
}

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', maxLength: 100 } },
} as const;

/** Engineering (docs/admin-portal.md §3.3). */
export function registerAdminEngineering(admin: FastifyInstance, db: Database) {
  admin.get('/health', async request => {
    await staffOf(db, request, 'logs.view');
    const checkStart = performance.now();
    await db.execute(sql`select 1`);
    return {
      database: { ok: true, responseMs: Math.round(performance.now() - checkStart) },
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      ...(await systemNumbers(db)),
    };
  });

  /** Timers needing a person: FAILED, plus PENDING ones well past due. */
  admin.get('/timers/attention', async request => {
    await staffOf(db, request, 'logs.view');
    const overdueBefore = new Date(Date.now() - OVERDUE_AFTER_MS);
    const [failed, overdue] = await Promise.all([
      db.select().from(timers).where(eq(timers.status, 'FAILED')).orderBy(desc(timers.updatedAt)).limit(100),
      db
        .select()
        .from(timers)
        .where(and(eq(timers.status, 'PENDING'), lt(timers.dueAt, overdueBefore)))
        .orderBy(timers.dueAt)
        .limit(100),
    ]);
    return { failed, overdue };
  });

  /**
   * Gives a FAILED timer another go (an intervention: reason required).
   * Safe because every handler first checks the job is still in the
   * situation the timer was set for.
   */
  admin.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/timers/:id/retry',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: reasonSchema },
        },
      },
    },
    async request => {
      const me = await staffOf(db, request, 'timers.retry');
      const reason = reasonFrom(request.body.reason);
      return db.transaction(async tx => {
        const [timer] = await tx
          .select()
          .from(timers)
          .where(eq(timers.id, request.params.id))
          .for('update');
        if (!timer) {
          throw new NotFoundError('Timer');
        }
        if (timer.status !== 'FAILED') {
          throw new BadRequestError('Only a failed timer can be retried');
        }
        const now = new Date();
        await tx
          .update(timers)
          .set({ status: 'PENDING', attempts: 0, dueAt: now, updatedAt: now })
          .where(eq(timers.id, timer.id));
        await audit(tx, request, {
          staffId: me.id,
          action: 'timer.retry',
          targetType: 'timer',
          targetId: timer.id,
          before: { status: timer.status, attempts: timer.attempts, lastError: timer.lastError },
          after: { status: 'PENDING', jobId: timer.jobId },
          reason,
        });
        return { id: timer.id, status: 'PENDING' };
      });
    },
  );

  admin.get<{ Querystring: { status?: 'OPEN' | 'RESOLVED' } }>(
    '/incidents',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { enum: ['OPEN', 'RESOLVED'], default: 'OPEN' } },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'logs.view');
      return db
        .select()
        .from(incidents)
        .where(eq(incidents.status, request.query.status ?? 'OPEN'))
        .orderBy(desc(incidents.lastSeenAt))
        .limit(200);
    },
  );

  admin.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/incidents/:id/resolve',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: reasonSchema },
        },
      },
    },
    async request => {
      const me = await staffOf(db, request, 'incidents.resolve');
      const reason = reasonFrom(request.body.reason);
      return db.transaction(async tx => {
        const now = new Date();
        const [resolved] = await tx
          .update(incidents)
          .set({ status: 'RESOLVED', resolvedBy: me.id, resolvedAt: now, resolutionNote: reason })
          .where(and(eq(incidents.id, request.params.id), eq(incidents.status, 'OPEN')))
          .returning();
        if (!resolved) {
          throw new NotFoundError('Open incident');
        }
        await audit(tx, request, {
          staffId: me.id,
          action: 'incident.resolve',
          targetType: 'incident',
          targetId: resolved.id,
          before: { status: 'OPEN', title: resolved.title, count: resolved.count },
          after: { status: 'RESOLVED' },
          reason,
        });
        return resolved;
      });
    },
  );
}
