import { eq } from 'drizzle-orm';
import type { Payment } from '../../../src/domain/billing/types';
import type { Job } from '../../../src/domain/jobs/types';
import type { Database, Tx } from '../db/client';
import { jobs, payments } from '../db/schema';
import { NotFoundError } from '../errors';

/**
 * Converts between database rows and the domain's Job, so the rest of the
 * server works with exactly the same Job type the apps use.
 */

type JobRow = typeof jobs.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

const iso = (d: Date) => d.toISOString();

export function toJob(row: JobRow): Job {
  return {
    ...row.request,
    ...row.extra,
    id: row.id,
    customerId: row.customerId,
    pricingMode: row.pricingMode,
    status: row.status,
    ...(row.providerId && { providerId: row.providerId }),
    ...(row.offeredProviderId && { offeredProviderId: row.offeredProviderId }),
    ...(row.baseQuoteId && { baseQuoteId: row.baseQuoteId }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(row.completedAt && { completedAt: iso(row.completedAt) }),
  };
}

export function toRow(job: Job): JobRow {
  const {
    id,
    customerId,
    providerId,
    offeredProviderId,
    status,
    pricingMode,
    baseQuoteId,
    createdAt,
    updatedAt,
    completedAt,
    requestType,
    categoryId,
    vehicle,
    answers,
    description,
    drivability,
    location,
    urgency,
    scheduledFor,
    // Whatever is left is the optional detail stored as JSON.
    ...extra
  } = job;
  return {
    id,
    customerId,
    providerId: providerId ?? null,
    offeredProviderId: offeredProviderId ?? null,
    status,
    pricingMode,
    baseQuoteId: baseQuoteId ?? null,
    request: {
      requestType,
      categoryId,
      vehicle,
      answers,
      description,
      drivability,
      location,
      urgency,
      ...(scheduledFor && { scheduledFor }),
    },
    extra,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    completedAt: completedAt ? new Date(completedAt) : null,
  };
}

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    jobId: row.jobId,
    purpose: row.purpose,
    ...(row.quoteId && { quoteId: row.quoteId }),
    method: row.method,
    phone: row.phone,
    amount: row.amount,
    status: row.status,
    ...(row.failureReason && {
      failureReason: row.failureReason as Payment['failureReason'],
    }),
    ...(row.receiptNumber && { receiptNumber: row.receiptNumber }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function findJob(db: Database | Tx, jobId: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!row) {
    throw new NotFoundError('Job');
  }
  return toJob(row);
}

/**
 * Loads a job and locks its row until the transaction ends. Two requests
 * changing the same job at once (a customer cancelling as a provider
 * accepts) then run one after the other, and the second sees the first's
 * result, instead of both acting on the same old status.
 */
export async function lockJob(tx: Tx, jobId: string) {
  const [row] = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .for('update');
  if (!row) {
    throw new NotFoundError('Job');
  }
  return toJob(row);
}

export async function saveJob(tx: Tx, job: Job) {
  await tx.update(jobs).set(toRow(job)).where(eq(jobs.id, job.id));
}
