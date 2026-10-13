import { and, eq, inArray } from 'drizzle-orm';
import { STK_TIMEOUT_MS } from '../../../src/domain/jobs/rules';
import { applyTransition } from '../../../src/domain/jobs/transitions';
import type { Job } from '../../../src/domain/jobs/types';
import type { Tx } from '../db/client';
import { jobEvents, payments, type TimerKind } from '../db/schema';
import { newId } from '../ids';
import { settle } from '../jobs/service';
import { lockJob, saveJob } from '../jobs/store';

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

export const TIMER_HANDLERS: Record<TimerKind, Handler> = {
  CALL_OUT_PAYMENT_DEADLINE: callOutPaymentDeadline,
};
