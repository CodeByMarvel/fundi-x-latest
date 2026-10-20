import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import { incidents, timers } from '../db/schema';
import type { RequestLog } from '../requestLog';
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
export function registerAdminEngineering(
  admin: FastifyInstance,
  db: Database,
  { requestLog, features }: { requestLog: RequestLog; features: Record<string, boolean> },
) {
  /**
   * Recent requests (this server only, since it started). `filter` keeps
   * errors (status 400+, which includes refusals) or slow ones (over 1 s).
   */
  admin.get<{ Querystring: { filter?: 'all' | 'errors' | 'server_errors' | 'slow' } }>(
    '/requests',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { filter: { enum: ['all', 'errors', 'server_errors', 'slow'], default: 'all' } },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'logs.view');
      const all = requestLog.list();
      const keep = {
        all: () => true,
        errors: (r: (typeof all)[number]) => r.status >= 400,
        server_errors: (r: (typeof all)[number]) => r.status >= 500,
        slow: (r: (typeof all)[number]) => r.ms >= 1000,
      }[request.query.filter ?? 'all'];
      const requests = all.filter(keep);
      const slowest = [...all].sort((a, b) => b.ms - a.ms)[0];
      return {
        requests: requests.slice(0, 200),
        totals: {
          seen: all.length,
          errors: all.filter(r => r.status >= 400).length,
          serverErrors: all.filter(r => r.status >= 500).length,
          slow: all.filter(r => r.ms >= 1000).length,
          slowestMs: slowest?.ms ?? 0,
        },
      };
    },
  );

  /** Every timer, filtered, newest due first. */
  admin.get<{ Querystring: { status?: 'PENDING' | 'DONE' | 'FAILED'; jobId?: string } }>(
    '/timers',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { enum: ['PENDING', 'DONE', 'FAILED'] },
            jobId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'logs.view');
      const { status, jobId } = request.query;
      const conditions = [status && eq(timers.status, status), jobId && eq(timers.jobId, jobId)].filter(c => !!c);
      return db
        .select()
        .from(timers)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(timers.dueAt))
        .limit(200);
    },
  );

  /** What's running: versions, switches, database size and row counts. */
  admin.get('/system', async request => {
    await staffOf(db, request, 'logs.view');
    const raw = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows;
    const [version] = raw(await db.execute(sql`select version() as version, pg_database_size(current_database())::bigint as bytes`));
    const tables = raw(
      await db.execute(sql`
        select relname as table, n_live_tup::bigint as rows
        from pg_stat_user_tables order by relname`),
    );
    const migrations = raw(
      await db.execute(sql`select count(*)::int as count, max(created_at)::bigint as last from drizzle.__drizzle_migrations`).catch(
        () => ({ rows: [] }),
      ),
    );
    return {
      server: {
        node: process.version,
        environment: process.env.NODE_ENV ?? 'development',
        startedAt: new Date(startedAt).toISOString(),
        commit: process.env.COMMIT_SHA ?? null,
      },
      features,
      database: {
        version: String(version?.version ?? '').split(',')[0],
        bytes: Number(version?.bytes ?? 0),
        migrations: migrations[0]
          ? { count: Number(migrations[0].count), lastAt: migrations[0].last ? new Date(Number(migrations[0].last)).toISOString() : null }
          : null,
        tables: tables.map(t => ({ table: String(t.table), rows: Number(t.rows) })),
      },
    };
  });

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
