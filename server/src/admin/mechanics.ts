import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import { providers, releases, reliabilityEvents, users } from '../db/schema';
import { ConflictError, NotFoundError } from '../errors';
import { reasonFrom, reasonSchema } from './reason';
import { audit, staffOf } from './session';

type Verification = 'PENDING' | 'VERIFIED' | 'REJECTED';

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** The reliability window the list shows (docs/job-flow.md §13). */
const RELIABILITY_DAYS = 30;

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', maxLength: 100 } },
} as const;

/**
 * Operations → Mechanics (docs/admin-portal.md §3.7): who is waiting to be
 * verified, and how each mechanic is doing. Verifying is what lets a new
 * mechanic go online; rejecting tells them why in the app.
 */
export function registerAdminMechanics(admin: FastifyInstance, db: Database) {
  /** Waiting first (oldest first: they've waited longest), then the rest. */
  admin.get<{ Querystring: { verification?: Verification; q?: string } }>(
    '/mechanics',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verification: { enum: ['PENDING', 'VERIFIED', 'REJECTED'] },
            q: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'users.view');
      const { verification, q } = request.query;
      const term = q?.trim();
      const since = new Date(Date.now() - RELIABILITY_DAYS * 86_400_000);
      const conditions = [
        verification && eq(providers.verification, verification),
        term &&
          or(
            ilike(users.name, `%${escapeLike(term)}%`),
            ilike(users.phone, `%${escapeLike(term.replace(/^0/, '254'))}%`),
            ilike(providers.businessName, `%${escapeLike(term)}%`),
            ilike(providers.specialty, `%${escapeLike(term)}%`),
          ),
      ].filter(c => !!c);
      return db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          email: users.email,
          status: users.status,
          type: providers.type,
          businessName: providers.businessName,
          specialty: providers.specialty,
          verification: providers.verification,
          verificationNote: providers.verificationNote,
          online: providers.online,
          locationAt: providers.locationAt,
          ratingTotal: providers.ratingTotal,
          ratingCount: providers.ratingCount,
          createdAt: providers.createdAt,
          // Full table names: inside a subquery a bare "id" is the inner table's.
          jobsDone: sql<number>`(select count(*) from jobs j where j.provider_id = "users"."id"
            and j.status = 'COMPLETED')::int`,
          reliabilityIssues: sql<number>`(select count(*) from reliability_events e
            where e.provider_id = "users"."id" and e.created_at > ${since})::int`,
        })
        .from(providers)
        .innerJoin(users, eq(users.id, providers.userId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(
          sql`case ${providers.verification} when 'PENDING' then 0 else 1 end`,
          sql`case when ${providers.verification} = 'PENDING' then ${providers.createdAt} end`,
          desc(providers.createdAt),
        )
        .limit(200);
    },
  );

  /** How many are waiting, for the dashboard. */
  admin.get('/mechanics/pending-count', async request => {
    await staffOf(db, request, 'users.view');
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(providers)
      .where(eq(providers.verification, 'PENDING'));
    return row;
  });

  /** A mechanic's reliability record and payouts, for their profile page. */
  admin.get<{ Params: { id: string } }>(
    '/mechanics/:id/record',
    { schema: { params: idParams } },
    async request => {
      await staffOf(db, request, 'users.view');
      const id = request.params.id;
      const [events, payouts] = await Promise.all([
        db
          .select()
          .from(reliabilityEvents)
          .where(eq(reliabilityEvents.providerId, id))
          .orderBy(desc(reliabilityEvents.createdAt))
          .limit(100),
        db
          .select()
          .from(releases)
          .where(eq(releases.providerId, id))
          .orderBy(desc(releases.createdAt))
          .limit(100),
      ]);
      const since = new Date(Date.now() - RELIABILITY_DAYS * 86_400_000);
      const counts: Record<string, number> = {};
      for (const e of events.filter(e => e.createdAt > since)) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
      }
      return { reliability: { days: RELIABILITY_DAYS, counts, events }, payouts };
    },
  );

  for (const [path, to, allowedFrom] of [
    ['verify', 'VERIFIED', ['PENDING', 'REJECTED']],
    ['reject', 'REJECTED', ['PENDING', 'VERIFIED']],
  ] as const) {
    admin.post<{ Params: { id: string }; Body: { reason: string } }>(
      `/mechanics/:id/${path}`,
      {
        schema: {
          params: idParams,
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['reason'],
            properties: { reason: reasonSchema },
          },
        },
      },
      async request => {
        const me = await staffOf(db, request, 'providers.verify');
        const reason = reasonFrom(request.body.reason);
        return db.transaction(async tx => {
          const [provider] = await tx
            .select()
            .from(providers)
            .where(eq(providers.userId, request.params.id))
            .for('update');
          if (!provider) {
            throw new NotFoundError('Mechanic');
          }
          if (!(allowedFrom as readonly string[]).includes(provider.verification)) {
            throw new ConflictError(
              'wrong_status',
              `This mechanic is already ${provider.verification.toLowerCase()}`,
            );
          }
          const at = new Date();
          await tx
            .update(providers)
            .set({
              verification: to,
              verificationNote: reason,
              verifiedAt: at,
              verifiedBy: me.id,
              // A rejected mechanic stops getting offers straight away.
              ...(to === 'REJECTED' && { online: false }),
              updatedAt: at,
            })
            .where(eq(providers.userId, provider.userId));
          await audit(tx, request, {
            staffId: me.id,
            action: `mechanic.${path}`,
            targetType: 'user',
            targetId: provider.userId,
            before: { verification: provider.verification },
            after: { verification: to },
            reason,
          });
          return { id: provider.userId, verification: to };
        });
      },
    );
  }
}
