import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  AUTO_CONFIRM_MS,
  NO_SHOW_WAIT_MS,
  SERVICE_PAYMENT_WINDOW_MS,
} from '../../../src/domain/jobs/rules';
import { isTerminalStatus } from '../../../src/domain/jobs/transitions';
import type { Job } from '../../../src/domain/jobs/types';
import {
  AdditionalQuotePendingError,
  buildQuoteItems,
  StaleQuoteError,
  sumItems,
  validateQuoteItems,
  QuoteValidationError,
} from '../../../src/domain/quotes/quotes';
import type { Quote, QuoteItemInput } from '../../../src/domain/quotes/types';
import type { Caller } from '../auth';
import type { Database, Tx } from '../db/client';
import { charges, jobs, providers, quotes, reliabilityEvents, users } from '../db/schema';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import { metresBetween } from '../matching/h3';
import { matchRound, startMatching } from '../matching/service';
import { scheduleTimer } from '../timers/schedule';
import { getJob, moveJob } from './service';
import { lockJob, saveJob, toJob, toQuote } from './store';

/**
 * Everything that happens to a job after booking (docs/job-flow.md §6),
 * except money arriving, which comes from M-Pesa. Each action:
 *
 *   lock the job → check it's the caller's → domain rule → save → return
 *
 * all in one transaction. The rulebook (applyTransition, inside moveJob)
 * refuses moves the current status doesn't allow, so e.g. "arrived"
 * before "start trip" is a 409 job_transition, never a corrupted job.
 */

type Action<T = Job> = (tx: Tx, job: Job, now: Date) => Promise<T>;

/**
 * Runs `action` on a job the caller may act on. Someone else's job is
 * "not found", the same as a job that doesn't exist.
 */
function asCustomer<T>(db: Database, caller: Caller, jobId: string, action: Action<T>) {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    if (caller.role !== 'CUSTOMER' || job.customerId !== caller.id) {
      throw new NotFoundError('Job');
    }
    return action(tx, job, new Date());
  });
}

/** The provider assigned to the job (or, for `offer`, the one being asked). */
function asProvider<T>(
  db: Database,
  caller: Caller,
  jobId: string,
  action: Action<T>,
  { offer = false } = {},
) {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    const theirs = offer ? job.offeredProviderId : job.providerId;
    if (caller.role !== 'PROVIDER' || theirs !== caller.id) {
      throw new NotFoundError('Job');
    }
    return action(tx, job, new Date());
  });
}

const reliability = (
  tx: Tx,
  providerId: string,
  jobId: string,
  type: (typeof reliabilityEvents.$inferInsert)['type'],
  at: Date,
) =>
  tx.insert(reliabilityEvents).values({ id: newId('reliab'), providerId, jobId, type, createdAt: at });

const after = (now: Date, ms: number) => new Date(now.getTime() + ms);

// ---------------------------------------------------------------- reads

/** A caller's jobs, newest first: a customer's bookings, or a provider's offers and work. */
export async function listJobs(db: Database, caller: Caller, limit = 50) {
  const mine =
    caller.role === 'CUSTOMER'
      ? eq(jobs.customerId, caller.id)
      : or(eq(jobs.providerId, caller.id), eq(jobs.offeredProviderId, caller.id));
  const rows = await db
    .select()
    .from(jobs)
    .where(mine)
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return rows.map(toJob);
}

export async function listQuotes(db: Database, caller: Caller, jobId: string) {
  await getJob(db, caller, jobId); // same visibility as the job itself
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.jobId, jobId))
    .orderBy(quotes.createdAt);
  return rows.map(toQuote);
}

/**
 * The customer's name and number for the mechanic on the job, so they can
 * call. Only while the job is under way: afterwards the number stays private.
 */
export async function jobContact(db: Database, caller: Caller, jobId: string) {
  const job = await getJob(db, caller, jobId);
  if (caller.role !== 'PROVIDER' || job.providerId !== caller.id || isTerminalStatus(job.status)) {
    throw new NotFoundError('Contact');
  }
  const [customer] = await db
    .select({ name: users.name, phone: users.phone })
    .from(users)
    .where(eq(users.id, job.customerId));
  return { name: customer.name, phone: customer.phone ?? '' };
}

// ------------------------------------------------------------- provider

export const acceptOffer = (db: Database, caller: Caller, jobId: string) =>
  asProvider(
    db,
    caller,
    jobId,
    async (tx, job, now) => {
      // The expiry timer may be a few seconds behind the clock; the clock wins.
      if (job.offerExpiresAt && Date.parse(job.offerExpiresAt) <= now.getTime()) {
        throw new ConflictError('offer_expired', 'This offer has expired');
      }
      return moveJob(tx, job, 'ACCEPTED', 'PROVIDER', now, {
        metadata: { providerId: caller.id },
        changes: { providerId: caller.id },
      });
    },
    { offer: true },
  );

/** Saying no is fine; it's recorded, and the search carries on at once. */
export const declineOffer = (db: Database, caller: Caller, jobId: string) =>
  asProvider(
    db,
    caller,
    jobId,
    async (tx, job, now) => {
      const searching = await moveJob(tx, job, 'SEARCHING', 'PROVIDER', now, {
        metadata: { providerId: caller.id, reason: 'declined' },
      });
      await reliability(tx, caller.id, jobId, 'offer_declined', now);
      return matchRound(tx, searching, now);
    },
    { offer: true },
  );

/**
 * Hands an accepted job back. The call-out stays in escrow and the search
 * starts again from ring 0; this provider won't be asked again.
 */
export const withdraw = (db: Database, caller: Caller, jobId: string, note: string) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    const enRoute = job.status === 'EN_ROUTE';
    const searching = await moveJob(tx, job, 'SEARCHING', 'PROVIDER', now, {
      metadata: { providerId: caller.id, reason: 'provider_withdrew' },
      changes: {
        reassignment: {
          providerId: caller.id,
          ...(note.trim() && { note: note.trim() }),
          at: now.toISOString(),
        },
        // A new provider makes a new promise.
        expectedArrivalAt: undefined,
      },
    });
    await reliability(
      tx,
      caller.id,
      jobId,
      enRoute ? 'withdrew_en_route' : 'withdrew_after_accepting',
      now,
    );
    return startMatching(tx, searching, now);
  });

/**
 * Road distance is roughly 1.4× the straight line, and Nairobi traffic
 * averages about 20 km/h. A placeholder until ETAs come from a routing
 * service (docs/job-flow.md §4: never from H3).
 */
export function estimateEtaMinutes(metres: number) {
  return Math.max(5, Math.ceil(((metres * 1.4) / 1000 / 20) * 60));
}

/** Without a recent position we can't estimate; assume a typical trip. */
const FALLBACK_ETA_MINUTES = 20;

export const startTrip = (db: Database, caller: Caller, jobId: string) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    const [me] = await tx
      .select({ lat: providers.lat, lng: providers.lng })
      .from(providers)
      .where(eq(providers.userId, caller.id));
    const etaMinutes =
      me?.lat != null && me.lng != null && job.location.coords
        ? estimateEtaMinutes(metresBetween({ lat: me.lat, lng: me.lng }, job.location.coords))
        : FALLBACK_ETA_MINUTES;
    return moveJob(tx, job, 'EN_ROUTE', 'PROVIDER', now, {
      metadata: { etaMinutes },
      changes: {
        etaMinutes,
        // Fixed now: the late rule measures from this promise, not the live ETA.
        expectedArrivalAt: after(now, etaMinutes * 60_000).toISOString(),
      },
    });
  });

export const markArrived = (db: Database, caller: Caller, jobId: string) =>
  asProvider(db, caller, jobId, (tx, job, now) =>
    moveJob(tx, job, 'ARRIVED', 'PROVIDER', now, {
      changes: { arrivedAt: now.toISOString() },
    }),
  );

/** QUOTED jobs: start looking at the vehicle. */
export const startInspection = (db: Database, caller: Caller, jobId: string) =>
  asProvider(db, caller, jobId, (tx, job, now) => moveJob(tx, job, 'DIAGNOSING', 'PROVIDER', now));

/** The agreed price is now due; it must reach escrow within 30 minutes. */
async function servicePaymentDue(tx: Tx, job: Job, now: Date) {
  await scheduleTimer(tx, {
    jobId: job.id,
    kind: 'SERVICE_PAYMENT_DEADLINE',
    dueAt: after(now, SERVICE_PAYMENT_WINDOW_MS),
    at: now,
  });
  return job;
}

/** FIXED jobs: the vehicle matches the booking, so the customer pays before work starts. */
export const readyToStart = (db: Database, caller: Caller, jobId: string) =>
  asProvider(db, caller, jobId, async (tx, job, now) =>
    servicePaymentDue(tx, await moveJob(tx, job, 'SERVICE_PAYMENT_PENDING', 'PROVIDER', now), now),
  );

/** After 15 minutes waiting at the location. The provider keeps the call-out. */
export const reportNoShow = (db: Database, caller: Caller, jobId: string) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    if (job.status !== 'ARRIVED') {
      throw new ConflictError('job_transition', 'You can only report a no-show after arriving');
    }
    const waited = now.getTime() - Date.parse(job.arrivedAt ?? job.updatedAt);
    if (waited < NO_SHOW_WAIT_MS) {
      throw new ConflictError('wait_longer', 'Wait 15 minutes at the location first');
    }
    return moveJob(tx, job, 'CANCELLED', 'PROVIDER', now, {
      metadata: { reason: 'customer_no_show' },
      changes: { cancellation: { by: 'PROVIDER', reason: 'customer_no_show', fromStatus: job.status } },
    });
  });

async function insertQuote(
  tx: Tx,
  job: Job,
  fields: Pick<Quote, 'kind' | 'version'> & { providerId: string; note?: string; reason?: string },
  inputs: QuoteItemInput[],
  now: Date,
): Promise<Quote> {
  validateQuoteItems(inputs);
  const items = buildQuoteItems(inputs, () => newId('item'));
  const quote: Quote = {
    id: newId('quote'),
    jobId: job.id,
    kind: fields.kind,
    issuedBy: 'PROVIDER',
    providerId: fields.providerId,
    version: fields.version,
    status: 'PENDING',
    items,
    total: sumItems(items),
    ...(fields.note?.trim() && { note: fields.note.trim() }),
    ...(fields.reason?.trim() && { reason: fields.reason.trim() }),
    createdAt: now.toISOString(),
  };
  await tx.insert(quotes).values({
    ...quote,
    providerId: fields.providerId,
    note: quote.note ?? null,
    reason: quote.reason ?? null,
    createdAt: now,
    respondedAt: null,
  });
  return quote;
}

const quoteRow = async (tx: Tx, quoteId: string) =>
  (await tx.select().from(quotes).where(eq(quotes.id, quoteId)))[0];

/** QUOTED jobs: the main quote after diagnosis. Returns the quote. */
export const sendQuote = (
  db: Database,
  caller: Caller,
  jobId: string,
  items: QuoteItemInput[],
  note?: string,
) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    const previous = job.baseQuoteId ? await quoteRow(tx, job.baseQuoteId) : undefined;
    const quote = await insertQuote(
      tx,
      job,
      { kind: 'BASE', version: (previous?.version ?? 0) + 1, providerId: caller.id, note },
      items,
      now,
    );
    await moveJob(tx, job, 'QUOTE_SENT', 'PROVIDER', now, {
      metadata: { quoteId: quote.id, total: quote.total },
      changes: { baseQuoteId: quote.id },
    });
    return quote;
  });

/** Takes the pending quote back to correct it; it can no longer be approved. */
export const reviseQuote = (db: Database, caller: Caller, jobId: string) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    const quote = job.baseQuoteId ? await quoteRow(tx, job.baseQuoteId) : undefined;
    if (!quote || quote.status !== 'PENDING') {
      throw new StaleQuoteError();
    }
    const next = await moveJob(tx, job, 'DIAGNOSING', 'PROVIDER', now, {
      metadata: { quoteId: quote.id, reason: 'revising_quote' },
    });
    await tx.update(quotes).set({ status: 'SUPERSEDED' }).where(eq(quotes.id, quote.id));
    return next;
  });

/** Extra work found during the job. The customer approves it by paying for it. */
export const raiseAdditionalQuote = (
  db: Database,
  caller: Caller,
  jobId: string,
  items: QuoteItemInput[],
  reason: string,
) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    if (job.status !== 'IN_PROGRESS') {
      throw new ConflictError('job_transition', 'Extra work can only be quoted while working');
    }
    if (!reason.trim()) {
      throw new QuoteValidationError('Say why the extra work is needed.');
    }
    return insertQuote(tx, job, { kind: 'ADDITIONAL', version: 1, providerId: caller.id, reason }, items, now);
  });

/** Done. The customer has 48 hours to confirm or report a problem. */
export const markWorkComplete = (db: Database, caller: Caller, jobId: string, summary: string) =>
  asProvider(db, caller, jobId, async (tx, job, now) => {
    const [pending] = await tx
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.jobId, jobId), eq(quotes.kind, 'ADDITIONAL'), eq(quotes.status, 'PENDING')))
      .limit(1);
    if (pending) {
      throw new AdditionalQuotePendingError();
    }
    const next = await moveJob(tx, job, 'AWAITING_CONFIRMATION', 'PROVIDER', now, {
      changes: { workSummary: summary.trim() || undefined },
    });
    await scheduleTimer(tx, { jobId, kind: 'AUTO_CONFIRM', dueAt: after(now, AUTO_CONFIRM_MS), at: now });
    return next;
  });

// ------------------------------------------------------------- customer

/**
 * The quote must still be the one on the customer's screen: open, and for
 * a main quote, the latest version.
 */
async function openQuote(tx: Tx, job: Job, quoteId: string) {
  const row = await quoteRow(tx, quoteId);
  if (
    !row ||
    row.jobId !== job.id ||
    row.status !== 'PENDING' ||
    (row.kind === 'BASE' && job.baseQuoteId !== quoteId)
  ) {
    throw new StaleQuoteError();
  }
  return row;
}

/** Approving the main quote: the price is charged and must be paid into escrow next. */
export const approveQuote = (db: Database, caller: Caller, jobId: string, quoteId: string) =>
  asCustomer(db, caller, jobId, async (tx, job, now) => {
    const quote = await openQuote(tx, job, quoteId);
    if (quote.kind === 'ADDITIONAL') {
      throw new ConflictError('pay_to_approve', 'Extra work is approved by paying for it');
    }
    const next = await moveJob(tx, job, 'SERVICE_PAYMENT_PENDING', 'CUSTOMER', now, {
      metadata: { quoteId, total: quote.total },
    });
    await tx.update(quotes).set({ status: 'APPROVED', respondedAt: now }).where(eq(quotes.id, quoteId));
    await tx.insert(charges).values({
      id: newId('chg'),
      jobId,
      purpose: 'SERVICE',
      amount: quote.total,
      description: 'Agreed work',
      quoteId,
      createdAt: now,
    });
    return servicePaymentDue(tx, next, now);
  });

/**
 * Declining the main quote ends the job (the call-out paid for the visit);
 * declining extra work just means it isn't done.
 */
export const rejectQuote = (db: Database, caller: Caller, jobId: string, quoteId: string) =>
  asCustomer(db, caller, jobId, async (tx, job, now) => {
    const quote = await openQuote(tx, job, quoteId);
    await tx.update(quotes).set({ status: 'REJECTED', respondedAt: now }).where(eq(quotes.id, quoteId));
    if (quote.kind === 'ADDITIONAL') {
      return job;
    }
    return moveJob(tx, job, 'CANCELLED', 'CUSTOMER', now, {
      metadata: { quoteId },
      changes: { cancellation: { by: 'CUSTOMER', reason: 'quote_declined', fromStatus: job.status } },
    });
  });

/** The work is good: the money in escrow goes to the provider. */
export const confirmCompletion = (db: Database, caller: Caller, jobId: string) =>
  asCustomer(db, caller, jobId, (tx, job, now) =>
    moveJob(tx, job, 'COMPLETED', 'CUSTOMER', now, {
      changes: { completedAt: now.toISOString() },
    }),
  );

/** Something's wrong: the money stays in escrow until Fundi-X support decides. */
export const disputeCompletion = (db: Database, caller: Caller, jobId: string, reason: string) =>
  asCustomer(db, caller, jobId, (tx, job, now) => {
    if (!reason.trim()) {
      throw new BadRequestError('Tell us what went wrong');
    }
    return moveJob(tx, job, 'DISPUTED', 'CUSTOMER', now, {
      metadata: { reason: reason.trim() },
      changes: { dispute: { reason: reason.trim() } },
    });
  });

/** Once per completed job. Feeds the provider's average and matching. */
export const rateJob = (db: Database, caller: Caller, jobId: string, stars: number, comment: string) =>
  asCustomer(db, caller, jobId, async (tx, job, now) => {
    if (job.status !== 'COMPLETED' || job.rating) {
      throw new ConflictError('cannot_rate', 'This job can no longer be rated');
    }
    const next: Job = {
      ...job,
      rating: { stars, comment: comment.trim(), createdAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    // Not a status change, so no event; just the job's details.
    await saveJob(tx, next);
    if (job.providerId) {
      await tx
        .update(providers)
        .set({
          ratingTotal: sql`${providers.ratingTotal} + ${stars}`,
          ratingCount: sql`${providers.ratingCount} + 1`,
        })
        .where(eq(providers.userId, job.providerId));
    }
    return next;
  });
