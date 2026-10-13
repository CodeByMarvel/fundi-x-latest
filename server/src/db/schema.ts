import {
  bigint,
  boolean,
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
import type {
  ProviderType,
  ReliabilityEventType,
} from '../../../src/domain/providers/types';
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

/** What an account is for. One person can hold a customer and a provider
 * account on the same phone: they're separate, like Uber's rider and
 * driver apps. Fundi-X staff are not users: see `staff`. */
export type UserRole = 'CUSTOMER' | 'PROVIDER';

/** Everyone who signs in to the phone app: customers and providers. */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** M-Pesa format, 2547XXXXXXXX. Login is phone + SMS code. */
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    role: text('role').$type<UserRole>().notNull(),
    /** SUSPENDED accounts are refused on every request (an admin action). */
    status: text('status').$type<'ACTIVE' | 'SUSPENDED'>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('users_phone_role_idx').on(t.phone, t.role)],
);

/**
 * The provider side of a PROVIDER user, keyed by the same id, so a job's
 * provider_id is both the provider and the account that signs in.
 */
export const providers = pgTable('providers', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  type: text('type').$type<ProviderType>().notNull(),
  /** A garage's trading name; a solo mechanic goes by the user's name. */
  businessName: text('business_name'),
  specialty: text('specialty').notNull(),
  /** Where payouts go. Often, but not always, the login phone. */
  payoutPhone: text('payout_phone').notNull(),
  /** Only VERIFIED providers are offered jobs (checked by an admin). */
  verification: text('verification')
    .$type<'PENDING' | 'VERIFIED' | 'REJECTED'>()
    .notNull(),
  /** The provider's "available" switch. */
  online: boolean('online').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Values the business changes without a code release, such as the call-out
 * fee. One row per key, holding the current value; a missing row means the
 * default in settings.ts applies.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  /** The staff member who last changed it. */
  updatedBy: text('updated_by').references(() => staff.id),
  updatedAt: updatedAt(),
});

/**
 * Fundi-X people who use the admin console. Kept apart from app users:
 * they sign in differently (Google, by email) and can move money, so a
 * weakness in phone login can never reach this side. What each one may do
 * comes from `role` (see admin/permissions.ts).
 */
export const staff = pgTable('staff', {
  id: text('id').primaryKey(),
  /** Stored lowercase. Only these addresses can sign in. */
  email: text('email').notNull().unique(),
  name: text('name'),
  role: text('role').$type<StaffRole>().notNull(),
  status: text('status').$type<'ACTIVE' | 'DISABLED'>().notNull(),
  /**
   * Google's permanent id for the account, saved at first sign-in. Later
   * sign-ins must match it, so the email alone is never enough.
   */
  googleSubject: text('google_subject').unique(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Staff roles. One for now; more are added in admin/permissions.ts. */
export type StaffRole = 'OWNER';

/**
 * Signed-in admin console sessions. The browser holds a random token in a
 * cookie; only its SHA-256 hash is stored, so a leaked database can't be
 * used to sign in.
 */
export const staffSessions = pgTable(
  'staff_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.id),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  t => [index('staff_sessions_staff_idx').on(t.staffId)],
);

/**
 * Everything done from the admin console, and every sign-in attempt:
 * who, what, to which record, the value before and after. Rows are only
 * ever added.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    /** Null for attempts by someone who isn't staff (e.g. denied sign-in). */
    staffId: text('staff_id').references(() => staff.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  t => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

/** References to a provider point at providers.user_id. */
const providerRef = (name: string) =>
  text(name).references(() => providers.userId);

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
    customerId: text('customer_id')
      .notNull()
      .references(() => users.id),
    providerId: providerRef('provider_id'),
    offeredProviderId: providerRef('offered_provider_id'),
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
    providerId: providerRef('provider_id').notNull(),
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
    providerId: providerRef('provider_id'),
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
    providerId: providerRef('provider_id').notNull(),
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
