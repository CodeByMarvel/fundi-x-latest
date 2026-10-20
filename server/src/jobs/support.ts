import { eq } from 'drizzle-orm';
import { escrowTotal } from '../../../src/domain/billing/ledger';
import type { DisputeResolution, Job, JobStatus } from '../../../src/domain/jobs/types';
import type { Database } from '../db/client';
import { payments } from '../db/schema';
import { BadRequestError, ConflictError } from '../errors';
import { startMatching } from '../matching/service';
import { reliability } from './actions';
import { moveJob } from './service';
import { lockJob, toPayment } from './store';

/**
 * What Fundi-X support can do to a job (docs/admin-portal.md §3.6). Each
 * is a SYSTEM move through the same rulebook as everyone else, with the
 * staff member and their reason in the event, so the job's timeline shows
 * exactly who stepped in and why. The caller writes the audit log entry.
 */

export type DisputeDecision =
  | { outcome: 'REWORK' }
  | { outcome: 'UPHOLD_PROVIDER' }
  | { outcome: 'SPLIT'; customerRefund: number; providerPayout: number };

/** Statuses support may cancel from: before the work is finished. */
export const SUPPORT_CANCELLABLE: JobStatus[] = [
  'CALL_OUT_PAYMENT_PENDING',
  'SEARCHING',
  'OFFERED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_SENT',
  'SERVICE_PAYMENT_PENDING',
  'IN_PROGRESS',
];

/** Statuses where a provider is assigned but hasn't started work. */
export const REASSIGNABLE: JobStatus[] = ['ACCEPTED', 'EN_ROUTE'];

const staffMetadata = (staffId: string, reason: string) => ({ staffId, reason });

/**
 * Support's decision on a dispute (docs/job-flow.md §9). REWORK sends the
 * provider back to fix it; UPHOLD_PROVIDER completes the job; SPLIT closes
 * it and divides exactly what's still in escrow.
 */
export function resolveDispute(
  db: Database,
  staffId: string,
  jobId: string,
  decision: DisputeDecision,
  reason: string,
): Promise<Job> {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    if (job.status !== 'DISPUTED' || !job.dispute) {
      throw new ConflictError('not_disputed', 'This job is not waiting for a dispute decision');
    }
    const now = new Date();
    const at = now.toISOString();
    const metadata = { ...staffMetadata(staffId, reason), resolution: decision.outcome };

    if (decision.outcome === 'REWORK') {
      const resolution: DisputeResolution = { outcome: 'REWORK', note: reason, decidedBy: staffId, at };
      if (job.providerId) {
        await reliability(tx, job.providerId, jobId, 'dispute_rework', now);
      }
      return moveJob(tx, job, 'IN_PROGRESS', 'SYSTEM', now, {
        metadata,
        changes: { dispute: { ...job.dispute, resolution } },
      });
    }
    if (decision.outcome === 'UPHOLD_PROVIDER') {
      const resolution: DisputeResolution = { outcome: 'UPHOLD_PROVIDER', note: reason, decidedBy: staffId, at };
      return moveJob(tx, job, 'COMPLETED', 'SYSTEM', now, {
        metadata,
        changes: { dispute: { ...job.dispute, resolution }, completedAt: at },
      });
    }

    const { customerRefund, providerPayout } = decision;
    const held = escrowTotal(
      (await tx.select().from(payments).where(eq(payments.jobId, jobId))).map(toPayment),
      jobId,
    );
    if (
      ![customerRefund, providerPayout].every(n => Number.isInteger(n) && n >= 0) ||
      customerRefund + providerPayout !== held
    ) {
      throw new BadRequestError(
        `A split must divide exactly what is in escrow (${held / 100} shillings)`,
      );
    }
    const resolution: DisputeResolution = {
      outcome: 'SPLIT',
      customerRefund,
      providerPayout,
      note: reason,
      decidedBy: staffId,
      at,
    };
    if (customerRefund > 0 && job.providerId) {
      await reliability(tx, job.providerId, jobId, 'dispute_split', now);
    }
    return moveJob(tx, job, 'CANCELLED', 'SYSTEM', now, {
      metadata: { ...metadata, customerRefund, providerPayout },
      changes: {
        dispute: { ...job.dispute, resolution },
        cancellation: { by: 'SYSTEM', reason: 'dispute_resolved', fromStatus: 'DISPUTED', note: reason },
      },
    });
  });
}

/** Support closes a job; everything still in escrow goes back to the customer. */
export function supportCancel(db: Database, staffId: string, jobId: string, reason: string) {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    if (!SUPPORT_CANCELLABLE.includes(job.status)) {
      throw new ConflictError(
        'not_cancellable',
        job.status === 'AWAITING_CONFIRMATION' || job.status === 'DISPUTED'
          ? 'The work is finished: resolve it as a dispute instead'
          : 'This job has already ended',
      );
    }
    return moveJob(tx, job, 'CANCELLED', 'SYSTEM', new Date(), {
      metadata: staffMetadata(staffId, reason),
      changes: {
        cancellation: { by: 'SYSTEM', reason: 'support_cancelled', fromStatus: job.status, note: reason },
      },
    });
  });
}

/**
 * The assigned provider isn't coming: take the job off them and search
 * again from the first ring. The call-out stays in escrow.
 */
export function supportReassign(db: Database, staffId: string, jobId: string, reason: string) {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    if (!REASSIGNABLE.includes(job.status) || !job.providerId) {
      throw new ConflictError('not_reassignable', 'Only a job with a mechanic on the way can be reassigned');
    }
    const now = new Date();
    const searching = await moveJob(tx, job, 'SEARCHING', 'SYSTEM', now, {
      metadata: { ...staffMetadata(staffId, reason), providerId: job.providerId },
      changes: {
        reassignment: { providerId: job.providerId, note: reason, at: now.toISOString() },
        expectedArrivalAt: undefined,
      },
    });
    return startMatching(tx, searching, now);
  });
}
