import { SKILLS } from '../../../src/domain/providers/skills';
import { and, desc, eq, ilike, isNotNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import {
  appSessions,
  jobs,
  payments,
  providers,
  releases,
  staff,
  supportNotes,
  users,
} from '../db/schema';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import {
  type DisputeDecision,
  resolveDispute,
  supportCancel,
  supportReassign,
} from '../jobs/support';
import { can } from './permissions';
import { reasonFrom, reasonSchema } from './reason';
import { audit, staffOf } from './session';

const providerUser = alias(users, 'provider_user');

/** Makes `%` and `_` in a search mean themselves, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', maxLength: 100 } },
} as const;

const reasonBody = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: { reason: reasonSchema },
} as const;

/**
 * What's still held in escrow for a job: paid in, minus refunded and
 * released. Written with full table names: inside a subquery, a bare
 * "id" would mean the inner table's id, not the job's.
 */
export const heldInEscrowSql = sql<number>`(
  coalesce((select sum(p.amount) from payments p where p.job_id = "jobs"."id" and p.status = 'SUCCESS'), 0)
  - coalesce((select sum(r.amount) from refunds r where r.job_id = "jobs"."id"), 0)
  - coalesce((select sum(l.gross) from releases l where l.job_id = "jobs"."id"), 0)
)::bigint`.mapWith(Number);

/**
 * Customer care (docs/admin-portal.md §3.6): disputes, stepping in on a
 * job, customers and suspensions, and notes. Every change needs a reason
 * and lands in the audit log.
 */
export function registerAdminSupport(admin: FastifyInstance, db: Database) {
  // ---- Disputes -------------------------------------------------------

  /** Open disputes oldest first (they've waited longest); resolved ones newest first. */
  admin.get<{ Querystring: { state?: 'open' | 'resolved' } }>(
    '/disputes',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { state: { enum: ['open', 'resolved'], default: 'open' } },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'jobs.view');
      const open = request.query.state !== 'resolved';
      return db
        .select({
          id: jobs.id,
          status: jobs.status,
          pricingMode: jobs.pricingMode,
          request: jobs.request,
          dispute: sql`${jobs.extra}->'dispute'`,
          updatedAt: jobs.updatedAt,
          heldInEscrow: heldInEscrowSql,
          customer: { id: users.id, name: users.name, phone: users.phone },
          provider: { id: providerUser.id, name: providerUser.name },
        })
        .from(jobs)
        .leftJoin(users, eq(users.id, jobs.customerId))
        .leftJoin(providerUser, eq(providerUser.id, sql`coalesce(${jobs.providerId}, ${jobs.extra}->'reassignment'->>'providerId')`))
        .where(
          open
            ? eq(jobs.status, 'DISPUTED')
            : isNotNull(sql`${jobs.extra}->'dispute'->'resolution'`),
        )
        .orderBy(open ? jobs.updatedAt : desc(jobs.updatedAt))
        .limit(100);
    },
  );

  admin.post<{
    Params: { id: string };
    Body: { outcome: DisputeDecision['outcome']; reason: string; customerRefund?: number; providerPayout?: number };
  }>(
    '/jobs/:id/resolve-dispute',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'reason'],
          properties: {
            outcome: { enum: ['REWORK', 'UPHOLD_PROVIDER', 'SPLIT'] },
            reason: reasonSchema,
            customerRefund: { type: 'integer', minimum: 0 },
            providerPayout: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async request => {
      const me = await staffOf(db, request, 'disputes.resolve');
      const reason = reasonFrom(request.body.reason);
      const { outcome, customerRefund, providerPayout } = request.body;
      let decision: DisputeDecision;
      if (outcome === 'SPLIT') {
        if (customerRefund === undefined || providerPayout === undefined) {
          throw new BadRequestError('A split needs the refund and the payout');
        }
        decision = { outcome, customerRefund, providerPayout };
      } else {
        decision = { outcome };
      }
      const job = await resolveDispute(db, me.id, request.params.id, decision, reason);
      await audit(db, request, {
        staffId: me.id,
        action: 'dispute.resolve',
        targetType: 'job',
        targetId: job.id,
        before: { status: 'DISPUTED' },
        after: { status: job.status, ...decision },
        reason,
      });
      return job;
    },
  );

  // ---- Stepping in on a job -------------------------------------------

  admin.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/jobs/:id/cancel',
    { schema: { params: idParams, body: reasonBody } },
    async request => {
      const me = await staffOf(db, request, 'jobs.cancel');
      const reason = reasonFrom(request.body.reason);
      const job = await supportCancel(db, me.id, request.params.id, reason);
      await audit(db, request, {
        staffId: me.id,
        action: 'job.cancel',
        targetType: 'job',
        targetId: job.id,
        before: { status: job.cancellation?.fromStatus },
        after: { status: job.status },
        reason,
      });
      return job;
    },
  );

  admin.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/jobs/:id/reassign',
    { schema: { params: idParams, body: reasonBody } },
    async request => {
      const me = await staffOf(db, request, 'jobs.cancel');
      const reason = reasonFrom(request.body.reason);
      const job = await supportReassign(db, me.id, request.params.id, reason);
      await audit(db, request, {
        staffId: me.id,
        action: 'job.reassign',
        targetType: 'job',
        targetId: job.id,
        before: { providerId: job.reassignment?.providerId },
        after: { status: job.status },
        reason,
      });
      return job;
    },
  );

  // ---- Notes ----------------------------------------------------------

  /** Notes on a job need jobs.view; on a person, users.view. */
  const notePermission = (type: 'job' | 'user') => (type === 'job' ? 'jobs.view' : 'users.view');

  admin.get<{ Querystring: { targetType: 'job' | 'user'; targetId: string } }>(
    '/notes',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetId'],
          properties: {
            targetType: { enum: ['job', 'user'] },
            targetId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async request => {
      const { targetType, targetId } = request.query;
      await staffOf(db, request, notePermission(targetType));
      return db
        .select({
          id: supportNotes.id,
          body: supportNotes.body,
          createdAt: supportNotes.createdAt,
          staffEmail: staff.email,
        })
        .from(supportNotes)
        .leftJoin(staff, eq(staff.id, supportNotes.staffId))
        .where(and(eq(supportNotes.targetType, targetType), eq(supportNotes.targetId, targetId)))
        .orderBy(desc(supportNotes.createdAt));
    },
  );

  admin.post<{ Body: { targetType: 'job' | 'user'; targetId: string; body: string } }>(
    '/notes',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetId', 'body'],
          properties: {
            targetType: { enum: ['job', 'user'] },
            targetId: { type: 'string', maxLength: 100 },
            body: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { targetType, targetId } = request.body;
      const me = await staffOf(db, request, notePermission(targetType));
      const body = request.body.body.trim();
      if (!body) {
        throw new BadRequestError('Write something first');
      }
      const target = targetType === 'job' ? jobs : users;
      const [exists] = await db.select({ id: target.id }).from(target).where(eq(target.id, targetId));
      if (!exists) {
        throw new NotFoundError(targetType === 'job' ? 'Job' : 'User');
      }
      const [note] = await db
        .insert(supportNotes)
        .values({ id: newId('note'), targetType, targetId, staffId: me.id, body, createdAt: new Date() })
        .returning();
      await audit(db, request, {
        staffId: me.id,
        action: 'note.add',
        targetType,
        targetId,
        after: { noteId: note.id },
      });
      return reply.status(201).send(note);
    },
  );

  // ---- Customers and suspensions --------------------------------------

  /** Customers newest first, with how much they use Fundi-X. */
  admin.get<{ Querystring: { q?: string; status?: string; before?: string; limit?: number } }>(
    '/customers',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 100 },
            status: { enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] },
            before: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'users.view');
      const { q, status, before, limit = 50 } = request.query;
      const term = q?.trim();
      const conditions = [
        eq(users.role, 'CUSTOMER'),
        status && eq(users.status, status as 'ACTIVE'),
        before && lt(users.createdAt, new Date(before)),
        term &&
          or(
            ilike(users.name, `%${escapeLike(term)}%`),
            ilike(users.phone, `%${escapeLike(term.replace(/^0/, '254'))}%`),
            ilike(users.email, `%${escapeLike(term)}%`),
            ilike(users.id, `%${escapeLike(term)}%`),
          ),
      ].filter(c => !!c);
      return db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          email: users.email,
          status: users.status,
          createdAt: users.createdAt,
          // Full table names: see heldInEscrowSql.
          jobs: sql<number>`(select count(*) from jobs j where j.customer_id = "users"."id")::int`,
          openJobs: sql<number>`(select count(*) from jobs j where j.customer_id = "users"."id"
            and j.status not in ('COMPLETED', 'CANCELLED'))::int`,
          disputes: sql<number>`(select count(*) from jobs j where j.customer_id = "users"."id"
            and j.extra->'dispute' is not null)::int`,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(desc(users.createdAt))
        .limit(limit);
    },
  );

  /** One app user (customer or mechanic): profile, jobs, money, sign-ins. */
  admin.get<{ Params: { id: string } }>('/users/:id', { schema: { params: idParams } }, async request => {
    const me = await staffOf(db, request, 'users.view');
    const [user] = await db.select().from(users).where(eq(users.id, request.params.id));
    if (!user) {
      throw new NotFoundError('User');
    }
    const isProvider = user.role === 'PROVIDER';
    const mine = isProvider ? eq(jobs.providerId, user.id) : eq(jobs.customerId, user.id);
    const [userJobs, [sessions], [money]] = await Promise.all([
      db
        .select({
          id: jobs.id,
          status: jobs.status,
          pricingMode: jobs.pricingMode,
          request: jobs.request,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(mine)
        .orderBy(desc(jobs.createdAt))
        .limit(50),
      db
        .select({
          active: sql<number>`count(*) filter (where ${appSessions.revokedAt} is null and ${appSessions.expiresAt} > now())::int`,
          lastUsedAt: sql<string | null>`max(${appSessions.lastUsedAt})`,
        })
        .from(appSessions)
        .where(eq(appSessions.userId, user.id)),
      isProvider
        ? db
            .select({
              earned: sql<number>`coalesce(sum(${releases.net}), 0)::bigint`.mapWith(Number),
              commission: sql<number>`coalesce(sum(${releases.commission}), 0)::bigint`.mapWith(Number),
            })
            .from(releases)
            .where(eq(releases.providerId, user.id))
        : db
            .select({
              paid: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'SUCCESS'), 0)::bigint`.mapWith(Number),
              refunded: sql<number>`coalesce((select sum(r.amount) from refunds r
                join jobs j on j.id = r.job_id where j.customer_id = ${user.id}), 0)::bigint`.mapWith(Number),
            })
            .from(payments)
            .innerJoin(jobs, eq(jobs.id, payments.jobId))
            .where(eq(jobs.customerId, user.id)),
    ]);
    const [provider] = isProvider
      ? await db.select().from(providers).where(eq(providers.userId, user.id))
      : [];
    return {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        phoneVerifiedAt: user.phoneVerifiedAt,
        email: user.email,
        role: user.role,
        status: user.status,
        signsInWith: [user.googleSubject && 'Google', user.appleSubject && 'Apple'].filter(Boolean),
        createdAt: user.createdAt,
      },
      provider: provider
        ? {
            ...provider,
            // Readable for the reviewer; ids stay as they are in `skills`.
            skillLabels: SKILLS.filter(s => provider.skills?.includes(s.id)).map(s => s.label),
          }
        : null,
      jobs: userJobs,
      sessions,
      money,
      canSuspend: can(me.role, 'users.suspend'),
    };
  });

  for (const [path, from, to] of [
    ['suspend', 'ACTIVE', 'SUSPENDED'],
    ['unsuspend', 'SUSPENDED', 'ACTIVE'],
  ] as const) {
    admin.post<{ Params: { id: string }; Body: { reason: string } }>(
      `/users/:id/${path}`,
      { schema: { params: idParams, body: reasonBody } },
      async request => {
        const me = await staffOf(db, request, 'users.suspend');
        const reason = reasonFrom(request.body.reason);
        return db.transaction(async tx => {
          const [user] = await tx.select().from(users).where(eq(users.id, request.params.id)).for('update');
          if (!user) {
            throw new NotFoundError('User');
          }
          if (user.status !== from) {
            throw new ConflictError(
              'wrong_status',
              user.status === 'DELETED' ? 'This account was deleted' : `This account is already ${user.status.toLowerCase()}`,
            );
          }
          const at = new Date();
          await tx.update(users).set({ status: to, updatedAt: at }).where(eq(users.id, user.id));
          if (to === 'SUSPENDED' && user.role === 'PROVIDER') {
            // Off the map at once, so no new offers reach them.
            await tx.update(providers).set({ online: false, updatedAt: at }).where(eq(providers.userId, user.id));
          }
          await audit(tx, request, {
            staffId: me.id,
            action: `user.${path}`,
            targetType: 'user',
            targetId: user.id,
            before: { status: from },
            after: { status: to },
            reason,
          });
          return { id: user.id, status: to };
        });
      },
    );
  }
}
