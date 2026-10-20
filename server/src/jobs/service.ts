import { asc, eq } from 'drizzle-orm';
import { releaseLine } from '../../../src/domain/billing/commission';
import { settlementFor } from '../../../src/domain/billing/ledger';
import {
  CALL_OUT_PAYMENT_WINDOW_MS,
  isProviderLate,
} from '../../../src/domain/jobs/rules';
import {
  applyTransition,
  isTerminalStatus,
} from '../../../src/domain/jobs/transitions';
import type {
  CreateJobInput,
  Job,
  JobActor,
  JobEvent,
  JobEventMetadata,
  JobStatus,
} from '../../../src/domain/jobs/types';
import { calculateEstimate } from '../../../src/domain/pricing/engine';
import { PriceChangedError } from '../../../src/domain/pricing/PricingService';
import { buildQuoteItems, sumItems } from '../../../src/domain/quotes/quotes';
import type { Caller } from '../auth';
import type { Database, Tx } from '../db/client';
import {
  charges,
  jobEvents,
  jobs,
  payments,
  quotes,
  refunds,
  releases,
  reliabilityEvents,
  users,
} from '../db/schema';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import { liveCatalog } from '../catalog/store';
import { commissionRates, getSetting } from '../settings';
import { scheduleTimer } from '../timers/schedule';
import { findJob, lockJob, saveJob, toPayment, toRow } from './store';

/**
 * The job operations, each one: check who's calling → load (and lock) →
 * apply the domain rule → save everything in ONE transaction → return.
 * The rules themselves come from src/domain, the same code the apps run.
 */

/**
 * The one way a job changes status on the server: check the rule, save
 * the job and its event, and settle the money if the job just ended, all
 * in the caller's transaction. `changes` are fields set alongside (an
 * ETA, a cancellation…), applied after the rulebook cleared stale ones.
 */
export async function moveJob(
  tx: Tx,
  job: Job,
  to: JobStatus,
  actor: JobActor,
  now: Date,
  {
    metadata,
    changes,
  }: { metadata?: JobEventMetadata; changes?: Partial<Job> } = {},
): Promise<Job> {
  const { job: moved, event } = applyTransition(job, to, actor, {
    now: now.toISOString(),
    eventId: newId('evt'),
    metadata,
  });
  const next: Job = { ...moved, ...changes };
  await saveJob(tx, next);
  await tx.insert(jobEvents).values({ ...event, createdAt: now });
  if (isTerminalStatus(to)) {
    await settle(tx, next, now);
  }
  return next;
}

/** Customers see their own jobs; providers see jobs offered or assigned to them. */
function canSee(caller: Caller, job: Job) {
  return caller.role === 'CUSTOMER'
    ? job.customerId === caller.id
    : job.providerId === caller.id || job.offeredProviderId === caller.id;
}

/**
 * Books a job. The price is recalculated here and compared with what the
 * customer saw: the app's numbers are never trusted.
 */
export async function createJob(
  db: Database,
  caller: Caller,
  input: CreateJobInput,
): Promise<Job> {
  // M-Pesa charges a phone number, and the mechanic needs one to call.
  const [customer] = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, caller.id));
  if (!customer?.phone) {
    throw new ConflictError('phone_required', 'Add your M-Pesa number before booking');
  }
  // Matching searches outward from this point (docs/job-flow.md §4).
  if (!input.location.coords) {
    throw new BadRequestError('The vehicle location (coordinates) is required to book');
  }
  const { acceptedPrice, ...details } = input;
  const estimate = calculateEstimate(
    details,
    await getSetting(db, 'call_out_fee'),
    (await liveCatalog(db)).catalog,
  );
  const fixed = estimate.fixedService;
  if (
    estimate.callOut !== acceptedPrice.callOut ||
    fixed?.total !== acceptedPrice.fixedServiceTotal
  ) {
    throw new PriceChangedError();
  }

  const at = new Date();
  const job: Job = {
    ...details,
    // Settled by the estimate: only a fixed-price job with parts has a choice.
    partsOption: fixed && fixed.parts.length > 0 ? fixed.partsOption : undefined,
    id: newId('job'),
    customerId: caller.id,
    pricingMode: estimate.pricingMode,
    status: 'CALL_OUT_PAYMENT_PENDING',
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  };

  await db.transaction(async tx => {
    let fixedQuoteId: string | undefined;
    if (fixed) {
      // The customer accepted this price when booking.
      fixedQuoteId = newId('quote');
      job.baseQuoteId = fixedQuoteId;
    }
    await tx.insert(jobs).values(toRow(job));
    await tx.insert(charges).values({
      id: newId('chg'),
      jobId: job.id,
      purpose: 'CALL_OUT',
      amount: estimate.callOut,
      description: 'Call-out (transport & inspection)',
      createdAt: at,
    });
    if (fixed && fixedQuoteId) {
      const withParts = fixed.partsOption === 'MECHANIC';
      const items = buildQuoteItems(
        [...fixed.items, ...(withParts ? fixed.parts : [])],
        () => newId('item'),
      );
      await tx.insert(quotes).values({
        id: fixedQuoteId,
        jobId: job.id,
        kind: 'BASE',
        issuedBy: 'FUNDI_X',
        version: 1,
        status: 'APPROVED',
        items,
        total: sumItems(items),
        note: fixed.packageName,
        createdAt: at,
        respondedAt: at,
      });
      await tx.insert(charges).values({
        id: newId('chg'),
        jobId: job.id,
        purpose: 'SERVICE',
        amount: fixed.serviceTotal,
        description: 'Agreed work',
        quoteId: fixedQuoteId,
        createdAt: at,
      });
      // Parts are their own charge: their money goes to the mechanic as
      // soon as it's paid, with a smaller commission.
      if (withParts && fixed.partsTotal > 0) {
        await tx.insert(charges).values({
          id: newId('chg'),
          jobId: job.id,
          purpose: 'PARTS',
          amount: fixed.partsTotal,
          description: 'Parts',
          quoteId: fixedQuoteId,
          createdAt: at,
        });
      }
    }
    // Saved with the booking: if the booking exists, so does its deadline.
    await scheduleTimer(tx, {
      jobId: job.id,
      kind: 'CALL_OUT_PAYMENT_DEADLINE',
      dueAt: new Date(at.getTime() + CALL_OUT_PAYMENT_WINDOW_MS),
      at,
    });
    await tx.insert(jobEvents).values({
      id: newId('evt'),
      jobId: job.id,
      fromStatus: null,
      toStatus: job.status,
      actor: 'CUSTOMER',
      metadata: {
        callOut: estimate.callOut,
        fixedServiceTotal: fixed?.total ?? null,
        vehicleClass: fixed?.vehicleClass ?? null,
        partsOption: job.partsOption ?? null,
      },
      createdAt: at,
    });
  });
  return job;
}

export async function getJob(db: Database, caller: Caller, jobId: string) {
  const job = await findJob(db, jobId);
  // "Not found" rather than "forbidden": don't reveal that someone else's
  // job exists.
  if (!canSee(caller, job)) {
    throw new NotFoundError('Job');
  }
  return job;
}

export async function getJobEvents(
  db: Database,
  caller: Caller,
  jobId: string,
): Promise<JobEvent[]> {
  await getJob(db, caller, jobId);
  const rows = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(asc(jobEvents.createdAt));
  return rows.map(r => ({
    id: r.id,
    jobId: r.jobId,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    actor: r.actor,
    createdAt: r.createdAt.toISOString(),
    ...(r.metadata && { metadata: r.metadata }),
  }));
}

/**
 * The customer cancels. Whether that's allowed, and what happens to the
 * money, are both decided by the domain: the rulebook and settlementFor().
 */
export async function cancelJob(
  db: Database,
  caller: Caller,
  jobId: string,
): Promise<Job> {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    if (caller.role !== 'CUSTOMER' || job.customerId !== caller.id) {
      throw new NotFoundError('Job');
    }

    const at = new Date();
    // Decided now, from the clock: a provider arriving later can't undo it.
    const late = isProviderLate(job, at.getTime());
    const { job: moved, event } = applyTransition(
      job,
      'CANCELLED',
      'CUSTOMER',
      {
        now: at.toISOString(),
        eventId: newId('evt'),
      },
    );
    const next: Job = {
      ...moved,
      cancellation: {
        by: 'CUSTOMER',
        reason: late ? 'provider_late' : 'customer_cancelled',
        fromStatus: job.status,
      },
    };

    await saveJob(tx, next);
    await tx.insert(jobEvents).values({ ...event, createdAt: at });
    if (late && job.providerId) {
      await tx.insert(reliabilityEvents).values({
        id: newId('reliab'),
        providerId: job.providerId,
        jobId,
        type: 'late',
        createdAt: at,
      });
    }
    await settle(tx, next, at);
    return next;
  });
}

/**
 * Runs when a job ends: asks the domain who gets the money in escrow, and
 * records the refunds and payout in the same transaction as the status
 * change, so the two can never disagree.
 */
export async function settle(tx: Tx, job: Job, at: Date) {
  const paid = (
    await tx.select().from(payments).where(eq(payments.jobId, job.id))
  ).map(toPayment);
  const { refund, release } = settlementFor(job, paid);
  const rates = await commissionRates(tx);

  for (const move of refund) {
    await tx.insert(refunds).values({
      id: newId('ref'),
      jobId: job.id,
      paymentId: move.payment.id,
      amount: move.amount,
      reason: job.cancellation?.reason ?? 'job_closed',
      // Sent to M-Pesa (B2C) by a later slice; SUCCESS once confirmed.
      status: 'PENDING',
      createdAt: at,
      updatedAt: at,
    });
  }
  if (release.length > 0 && job.providerId) {
    const lines = release.map(({ payment, amount }) =>
      releaseLine(payment.id, payment.purpose, amount, rates),
    );
    const gross = lines.reduce((s, l) => s + l.gross, 0);
    const commission = lines.reduce((s, l) => s + l.commission, 0);
    await tx.insert(releases).values({
      id: newId('rel'),
      jobId: job.id,
      providerId: job.providerId,
      lines,
      gross,
      commission,
      net: gross - commission,
      createdAt: at,
    });
  }
}
