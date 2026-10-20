import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { TRANSITIONS } from '../../../src/domain/jobs/transitions';
import type { JobStatus } from '../../../src/domain/jobs/types';
import type { Database } from '../db/client';
import {
  charges,
  incidents,
  jobEvents,
  jobMatching,
  jobs,
  ledgerEntries,
  ledgerLines,
  payments,
  providers,
  quotes,
  refunds,
  releases,
  timers,
  users,
} from '../db/schema';
import { NotFoundError } from '../errors';
import { getSetting } from '../settings';
import { findJob } from '../jobs/store';
import { staffOf } from './session';

export const JOB_STATUSES = Object.keys(TRANSITIONS) as JobStatus[];

const providerUser = alias(users, 'provider_user');

/** Makes `%` and `_` in a search mean themselves, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * Operations → Jobs (docs/admin-portal.md §3.2). Read-only: staff inspect
 * and investigate here; interventions arrive as separate, named actions.
 */
export function registerAdminJobs(admin: FastifyInstance, db: Database) {
  /** Newest first. `q` matches job id, customer name or phone, or plate. */
  admin.get<{
    Querystring: { q?: string; status?: JobStatus; before?: string; limit?: number };
  }>(
    '/jobs',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 100 },
            status: { enum: JOB_STATUSES },
            before: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'jobs.view');
      const { q, status, before, limit = 50 } = request.query;
      const term = q?.trim();
      const conditions = [
        status && eq(jobs.status, status),
        before && lt(jobs.createdAt, new Date(before)),
        term &&
          or(
            ilike(jobs.id, `%${escapeLike(term)}%`),
            ilike(users.name, `%${escapeLike(term)}%`),
            ilike(users.phone, `%${escapeLike(term)}%`),
            // Plates are typed with and without spaces: "KDA 123A", "kda123a".
            sql`replace(upper(${jobs.request}->'vehicle'->>'registration'), ' ', '')
                like ${`%${escapeLike(term.replace(/\s+/g, '').toUpperCase())}%`}`,
          ),
      ].filter(c => !!c);

      return db
        .select({
          id: jobs.id,
          status: jobs.status,
          pricingMode: jobs.pricingMode,
          request: jobs.request,
          createdAt: jobs.createdAt,
          updatedAt: jobs.updatedAt,
          customer: { id: users.id, name: users.name, phone: users.phone },
          provider: { id: providerUser.id, name: providerUser.name },
        })
        .from(jobs)
        .leftJoin(users, eq(users.id, jobs.customerId))
        .leftJoin(providerUser, eq(providerUser.id, jobs.providerId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(jobs.createdAt))
        .limit(limit);
    },
  );

  /** Everything known about one job, for investigating it. */
  admin.get<{ Params: { id: string } }>(
    '/jobs/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'jobs.view');
      const job = await findJob(db, request.params.id).catch(() => {
        throw new NotFoundError('Job');
      });
      const [customer] = await db.select().from(users).where(eq(users.id, job.customerId));
      const providerId = job.providerId ?? job.offeredProviderId;
      const [provider] = providerId
        ? await db
            .select({
              id: users.id,
              name: users.name,
              phone: users.phone,
              status: users.status,
              type: providers.type,
              businessName: providers.businessName,
              specialty: providers.specialty,
              verification: providers.verification,
              online: providers.online,
            })
            .from(users)
            .innerJoin(providers, eq(providers.userId, users.id))
            .where(eq(users.id, providerId))
        : [];

      const [events, jobCharges, jobPayments, jobRefunds, jobReleases, jobQuotes, jobTimers, jobIncidents] =
        await Promise.all([
          db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id)).orderBy(asc(jobEvents.createdAt)),
          db.select().from(charges).where(eq(charges.jobId, job.id)).orderBy(asc(charges.createdAt)),
          db.select().from(payments).where(eq(payments.jobId, job.id)).orderBy(asc(payments.createdAt)),
          db.select().from(refunds).where(eq(refunds.jobId, job.id)).orderBy(asc(refunds.createdAt)),
          db.select().from(releases).where(eq(releases.jobId, job.id)).orderBy(asc(releases.createdAt)),
          db.select().from(quotes).where(eq(quotes.jobId, job.id)).orderBy(asc(quotes.createdAt)),
          db.select().from(timers).where(eq(timers.jobId, job.id)).orderBy(asc(timers.dueAt)),
          db.select().from(incidents).where(eq(incidents.jobId, job.id)).orderBy(desc(incidents.lastSeenAt)),
        ]);

      // Money is facts (job-flow.md §1 rule 2); these totals are calculated
      // from them, never stored.
      const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
      const paid = sum(jobPayments.filter(p => p.status === 'SUCCESS'));
      const refunded = sum(jobRefunds);
      const released = jobReleases.reduce((s, r) => s + r.gross, 0);
      const money = {
        charged: sum(jobCharges),
        paid,
        refunded,
        releasedToProvider: jobReleases.reduce((s, r) => s + r.net, 0),
        commission: jobReleases.reduce((s, r) => s + r.commission, 0),
        heldInEscrow: paid - refunded - released,
      };

      const [area] = await db
        .select({ cell: jobs.h3Cell, zone: jobs.locationZone })
        .from(jobs)
        .where(eq(jobs.id, job.id));
      const [search] = await db.select().from(jobMatching).where(eq(jobMatching.jobId, job.id));
      // The job's ledger entries with their lines (docs/ledger.md).
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.jobId, job.id))
        .orderBy(asc(ledgerEntries.createdAt));
      const lines = entries.length
        ? await db
            .select()
            .from(ledgerLines)
            .where(inArray(ledgerLines.entryId, entries.map(e => e.id)))
        : [];
      const ledger = entries.map(e => ({
        ...e,
        lines: lines.filter(l => l.entryId === e.id).map(l => ({ account: l.account, amount: l.amount })),
      }));

      return {
        job,
        // How far matching had to look (docs/job-flow.md §4).
        matching: {
          cell: area?.cell ?? null,
          zone: area?.zone ?? null,
          ring: search?.ring ?? null,
          maxRing: await getSetting(db, 'matching_max_ring'),
          startedAt: search?.startedAt ?? null,
        },
        customer: customer
          ? { id: customer.id, name: customer.name, phone: customer.phone, status: customer.status }
          : null,
        provider: provider ?? null,
        providerIsOffer: !job.providerId && !!job.offeredProviderId,
        money,
        events,
        charges: jobCharges,
        payments: jobPayments,
        refunds: jobRefunds,
        releases: jobReleases,
        quotes: jobQuotes,
        timers: jobTimers,
        incidents: jobIncidents,
        ledger,
      };
    },
  );
}
