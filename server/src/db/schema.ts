import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { ReleaseLine } from '../../../src/domain/billing/types';
import type {
  Job,
  JobActor,
  JobEventMetadata,
  JobRequestDetails,
  JobStatus,
  PricingMode,
} from '../../../src/domain/jobs/types';
import type { ReliabilityEventType } from '../../../src/domain/providers/types';
import type {
  QuoteIssuer,
  QuoteItem,
  QuoteKind,
  QuoteStatus,
} from '../../../src/domain/quotes/types';

/**
 * Database tables. The rule of thumb: a column for anything we search or
 * filter by (status, who owns the job), JSON for details that are always
 * read together with the job (vehicle, answers, cancellation).
 *
 * Money is whole cents in BIGINT columns, never decimals, same as the app.
 */

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull();
const cents = (name: string) => bigint(name, { mode: 'number' }).notNull();

/** The job's optional fields that are read with it but never searched on. */
export type JobExtra = Pick<
  Job,
  | 'offerExpiresAt'
  | 'etaMinutes'
  | 'expectedArrivalAt'
  | 'arrivedAt'
  | 'reassignment'
  | 'workSummary'
  | 'cancellation'
  | 'dispute'
  | 'rating'
>;

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    providerId: text('provider_id'),
    offeredProviderId: text('offered_provider_id'),
    status: text('status').$type<JobStatus>().notNull(),
    pricingMode: text('pricing_mode').$type<PricingMode>().notNull(),
    baseQuoteId: text('base_quote_id'),
    /** What the customer described when booking. Never changes. */
    request: jsonb('request').$type<JobRequestDetails>().notNull(),
    extra: jsonb('extra').$type<JobExtra>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  t => [
    index('jobs_customer_idx').on(t.customerId),
    index('jobs_provider_idx').on(t.providerId),
    index('jobs_status_idx').on(t.status),
  ],
);

/** The audit trail: one row per status change. Rows are only ever added. */
export const jobEvents = pgTable(
  'job_events',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    fromStatus: text('from_status').$type<JobStatus>(),
    toStatus: text('to_status').$type<JobStatus>().notNull(),
    actor: text('actor').$type<JobActor>().notNull(),
    metadata: jsonb('metadata').$type<JobEventMetadata>(),
    createdAt: createdAt(),
  },
  t => [index('job_events_job_idx').on(t.jobId)],
);

/** Something the customer owes. Only ever added. */
export const charges = pgTable(
  'charges',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    purpose: text('purpose').$type<'CALL_OUT' | 'SERVICE'>().notNull(),
    amount: cents('amount'),
    description: text('description').notNull(),
    quoteId: text('quote_id'),
    createdAt: createdAt(),
  },
  t => [index('charges_job_idx').on(t.jobId)],
);

/** Money sent into escrow through M-Pesa. */
export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    purpose: text('purpose').$type<'CALL_OUT' | 'SERVICE'>().notNull(),
    quoteId: text('quote_id'),
    method: text('method').$type<'MPESA'>().notNull(),
    phone: text('phone').notNull(),
    amount: cents('amount'),
    status: text('status')
      .$type<'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'>()
      .notNull(),
    failureReason: text('failure_reason'),
    receiptNumber: text('receipt_number'),
    /**
     * M-Pesa's id for the STK request. Unique, so a confirmation that
     * arrives twice can only ever match one payment (exactly-once).
     */
    checkoutRequestId: text('checkout_request_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    index('payments_job_idx').on(t.jobId),
    uniqueIndex('payments_checkout_request_idx').on(t.checkoutRequestId),
  ],
);

/** Money returned from escrow to the customer. */
export const refunds = pgTable(
  'refunds',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    amount: cents('amount'),
    reason: text('reason').notNull(),
    status: text('status').$type<'PENDING' | 'SUCCESS'>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('refunds_job_idx').on(t.jobId)],
);

/** Money paid out of escrow to the provider when a job ends. */
export const releases = pgTable(
  'releases',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    providerId: text('provider_id').notNull(),
    lines: jsonb('lines').$type<ReleaseLine[]>().notNull(),
    gross: cents('gross'),
    commission: cents('commission'),
    net: cents('net'),
    createdAt: createdAt(),
  },
  t => [index('releases_provider_idx').on(t.providerId)],
);

/** Base and additional quotes. Agreed lines are copied in, so later
 * catalog price changes never alter a booked job. */
export const quotes = pgTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    kind: text('kind').$type<QuoteKind>().notNull(),
    issuedBy: text('issued_by').$type<QuoteIssuer>().notNull(),
    providerId: text('provider_id'),
    version: integer('version').notNull(),
    status: text('status').$type<QuoteStatus>().notNull(),
    items: jsonb('items').$type<QuoteItem[]>().notNull(),
    total: cents('total'),
    note: text('note'),
    reason: text('reason'),
    createdAt: createdAt(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  t => [index('quotes_job_idx').on(t.jobId)],
);

/** Facts about provider reliability (docs/job-flow.md §13). Only added. */
export const reliabilityEvents = pgTable(
  'reliability_events',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    type: text('type').$type<ReliabilityEventType>().notNull(),
    createdAt: createdAt(),
  },
  t => [index('reliability_provider_idx').on(t.providerId)],
);

/** What a timer does when it fires. Each kind has a handler in timers/. */
export type TimerKind = 'CALL_OUT_PAYMENT_DEADLINE';

/**
 * "Do this to that job at this time", kept in the database so a restart
 * can't lose it. The worker fires PENDING timers once due_at has passed;
 * one that was due while the server was down fires as soon as it's back.
 */
export const timers = pgTable(
  'timers',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    kind: text('kind').$type<TimerKind>().notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** DONE once handled; FAILED after repeated errors (needs a person). */
    status: text('status').$type<'PENDING' | 'DONE' | 'FAILED'>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // The worker's question is always "which PENDING timers are due?".
  t => [index('timers_due_idx').on(t.status, t.dueAt)],
);
