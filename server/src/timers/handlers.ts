import { and, eq, inArray } from 'drizzle-orm';
import { AUTO_CONFIRM_MS, STK_TIMEOUT_MS } from '../../../src/domain/jobs/rules';
import { applyTransition } from '../../../src/domain/jobs/transitions';
import type { Job } from '../../../src/domain/jobs/types';
import type { Tx } from '../db/client';
import { jobEvents, payments, type TimerKind } from '../db/schema';
import { newId } from '../ids';
import { moveJob, settle } from '../jobs/service';
import { lockJob, saveJob } from '../jobs/store';
import { expireOffer, matchRound } from '../matching/service';
import { expireStalePayments } from '../payments/service';

/**
 * What a handler decided: the timer is finished, or should fire again at
 * `retryAt` (e.g. the customer is mid-payment).
 */
export type TimerOutcome = { done: true } | { done: false; retryAt: Date };

type Handler = (tx: Tx, jobId: string, now: Date) => Promise<TimerOutcome>;

const DONE: TimerOutcome = { done: true };

/**
 * docs/job-flow.md: a booking whose call-out hasn't reached escrow within
 * 30 minutes is closed by the system. Nothing was paid, so nothing is owed.
 */
const callOutPaymentDeadline: Handler = async (tx, jobId, now) => {
  const job = await lockJob(tx, jobId);
  // The timer was set for one situation. If the job has left it (paid, or
  // the customer cancelled), there's nothing to do. This check is what
  // makes it safe never to delete timers.
  if (job.status !== 'CALL_OUT_PAYMENT_PENDING') {
    return DONE;
  }
  const paying = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.jobId, jobId),
        inArray(payments.status, ['PENDING', 'PROCESSING']),
      ),
    )
    .limit(1);
  if (paying.length > 0) {
    // Don't cut off a customer who is entering their PIN right now.
    return { done: false, retryAt: new Date(now.getTime() + STK_TIMEOUT_MS) };
  }

  const { job: moved, event } = applyTransition(job, 'CANCELLED', 'SYSTEM', {
    now: now.toISOString(),
    eventId: newId('evt'),
    metadata: { reason: 'call_out_unpaid' },
  });
  const next: Job = {
    ...moved,
    cancellation: {
      by: 'SYSTEM',
      reason: 'call_out_unpaid',
      fromStatus: job.status,
    },
  };
  await saveJob(tx, next);
  await tx.insert(jobEvents).values({ ...event, createdAt: now });
  await settle(tx, next, now);
  return DONE;
};

/** True while the customer is in the middle of an M-Pesa payment for this job. */
async function paymentInFlight(tx: Tx, jobId: string) {
  const paying = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), inArray(payments.status, ['PENDING', 'PROCESSING'])))
    .limit(1);
  return paying.length > 0;
}

/**
 * The agreed price didn't reach escrow within 30 minutes: the job ends
 * (`service_unpaid`). Work never started, so the provider keeps only the
 * call-out.
 */
const servicePaymentDeadline: Handler = async (tx, jobId, now) => {
  const job = await lockJob(tx, jobId);
  if (job.status !== 'SERVICE_PAYMENT_PENDING') {
    return DONE;
  }
  if (await paymentInFlight(tx, jobId)) {
    return { done: false, retryAt: new Date(now.getTime() + STK_TIMEOUT_MS) };
  }
  await moveJob(tx, job, 'CANCELLED', 'SYSTEM', now, {
    metadata: { reason: 'service_unpaid' },
    changes: { cancellation: { by: 'SYSTEM', reason: 'service_unpaid', fromStatus: job.status } },
  });
  return DONE;
};

/**
 * 48 hours without a confirmation or dispute counts as confirmed. A job
 * that went back to work (dispute → rework) and finished again has a newer
 * timer of its own, so this one only acts if 48 h have passed since the
 * job last changed.
 */
const autoConfirm: Handler = async (tx, jobId, now) => {
  const job = await lockJob(tx, jobId);
  if (
    job.status === 'AWAITING_CONFIRMATION' &&
    Date.parse(job.updatedAt) + AUTO_CONFIRM_MS <= now.getTime()
  ) {
    await moveJob(tx, job, 'COMPLETED', 'SYSTEM', now, {
      metadata: { reason: 'auto_confirmed' },
      changes: { completedAt: now.toISOString() },
    });
  }
  return DONE;
};

/** The next matching round: look one ring further (matching/service.ts). */
const matchingRound: Handler = async (tx, jobId, now) => {
  const job = await lockJob(tx, jobId);
  if (job.status === 'SEARCHING') {
    await matchRound(tx, job, now);
  }
  return DONE;
};

/**
 * The provider didn't answer in time. If the job has moved on (accepted,
 * declined, cancelled), or this timer belongs to an earlier offer and a
 * newer one is still open, there's nothing to do.
 */
const offerExpiry: Handler = async (tx, jobId, now) => {
  const job = await lockJob(tx, jobId);
  if (
    job.status === 'OFFERED' &&
    job.offerExpiresAt &&
    Date.parse(job.offerExpiresAt) <= now.getTime()
  ) {
    await expireOffer(tx, job, now);
  }
  return DONE;
};

/** A PIN prompt M-Pesa has given up on: the customer can try again. */
const paymentTimeout: Handler = async (tx, jobId, now) => {
  await expireStalePayments(tx, jobId, now);
  return DONE;
};

export const TIMER_HANDLERS: Record<TimerKind, Handler> = {
  CALL_OUT_PAYMENT_DEADLINE: callOutPaymentDeadline,
  MATCHING_ROUND: matchingRound,
  OFFER_EXPIRY: offerExpiry,
  SERVICE_PAYMENT_DEADLINE: servicePaymentDeadline,
  AUTO_CONFIRM: autoConfirm,
  PAYMENT_TIMEOUT: paymentTimeout,
};
