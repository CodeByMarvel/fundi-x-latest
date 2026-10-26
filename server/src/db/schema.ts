import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  MoneyPurpose,
  PaymentPurpose,
  ReleaseLine,
} from '../../../src/domain/billing/types';
import type { Catalog } from '../../../src/domain/pricing/catalog';
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
    /**
     * M-Pesa format, 2547XXXXXXXX. Added after sign-in (M-Pesa and the
     * mechanic need it); required before booking.
     */
    phone: text('phone'),
    /**
     * When the phone was proven to be theirs: set by the first successful
     * M-Pesa payment from it (they typed their PIN). Cleared when the
     * number changes.
     */
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    name: text('name').notNull(),
    /** From Google or Apple; Apple's may be a private relay address. */
    email: text('email'),
    /** Google's and Apple's permanent account ids ("sub"), never reused. */
    googleSubject: text('google_subject'),
    appleSubject: text('apple_subject'),
    role: text('role').$type<UserRole>().notNull(),
    /**
     * SUSPENDED: refused on every request (an admin action).
     * DELETED: the person deleted their account; personal details are
     * wiped, the row stays so past jobs and payments still add up.
     */
    status: text('status').$type<'ACTIVE' | 'SUSPENDED' | 'DELETED'>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('users_phone_role_idx').on(t.phone, t.role),
    // One customer and one provider account per Google or Apple account.
    uniqueIndex('users_google_role_idx').on(t.googleSubject, t.role),
    uniqueIndex('users_apple_role_idx').on(t.appleSubject, t.role),
  ],
);

/**
 * Signed-in app sessions (customers and providers). The phone keeps a
 * random token in its secure storage; only the SHA-256 hash is stored here.
 * Checked on every request, so revoking one ends it at once.
 */
export const appSessions = pgTable(
  'app_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    method: text('method').$type<'google' | 'apple'>().notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    /** Moves forward while the session is used (60 days of inactivity ends it). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  t => [index('app_sessions_user_idx').on(t.userId)],
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
  /**
   * Why Fundi-X rejected (or later verified) the profile, in words the
   * mechanic sees in the app. Set with the decision in the admin portal.
   */
  verificationNote: text('verification_note'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: text('verified_by'),
  /** The provider's "available" switch. */
  online: boolean('online').notNull().default(false),
  /**
   * Last reported position, sent by the app while online. Matching only
   * uses positions newer than PROVIDER_LOCATION_MAX_AGE_MS: a phone that
   * stopped reporting may be off, or far away by now.
   */
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  /** The H3 cell (matching resolution) of lat/lng, what matching searches. */
  h3Cell: text('h3_cell'),
  locationAt: timestamp('location_at', { withTimezone: true }),
  /** Sum and count of customers' stars, so the average is exact. */
  ratingTotal: integer('rating_total').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('providers_h3_cell_idx').on(t.h3Cell)]);

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

/** Staff roles; what each may do is in admin/permissions.ts. */
export const STAFF_ROLES = [
  'OWNER',
  'OPERATIONS',
  'SUPPORT',
  'FINANCE',
  'DEVELOPER',
  'COMPLIANCE',
  'MANAGER',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

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
    /** Why, in the staff member's words. Required for interventions. */
    reason: text('reason'),
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
    /**
     * Both worked out from the request's coordinates (matching/h3.ts), so
     * they can never disagree with it. h3_cell is where matching searches
     * from; location_zone is a coarse cell (several km across) for pricing
     * and demand analysis without exposing addresses.
     */
    h3Cell: text('h3_cell'),
    locationZone: text('location_zone'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  t => [
    index('jobs_customer_idx').on(t.customerId),
    index('jobs_provider_idx').on(t.providerId),
    index('jobs_status_idx').on(t.status),
    index('jobs_location_zone_idx').on(t.locationZone),
  ],
);

/**
 * How far matching has got for a job: the ring it searches out to now.
 * Created when the job starts SEARCHING; kept afterwards so the admin
 * portal can show how far the search had to go.
 */
export const jobMatching = pgTable('job_matching', {
  jobId: text('job_id')
    .primaryKey()
    .references(() => jobs.id),
  ring: integer('ring').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  updatedAt: updatedAt(),
});

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
    purpose: text('purpose').$type<MoneyPurpose>().notNull(),
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
    purpose: text('purpose').$type<PaymentPurpose>().notNull(),
    quoteId: text('quote_id'),
    method: text('method').$type<'MPESA'>().notNull(),
    phone: text('phone').notNull(),
    amount: cents('amount'),
    /**
     * Of `amount`, what's for the parts (fixed-price jobs where the
     * mechanic brings them). Released to the mechanic on success.
     */
    partsAmount: bigint('parts_amount', { mode: 'number' }).notNull().default(0),
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
    merchantRequestId: text('merchant_request_id'),
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
export type TimerKind =
  | 'CALL_OUT_PAYMENT_DEADLINE'
  /** Search again, one ring wider (matching/service.ts). */
  | 'MATCHING_ROUND'
  /** The provider didn't answer the offer in time. */
  | 'OFFER_EXPIRY'
  /** The agreed price must reach escrow within 30 minutes. */
  | 'SERVICE_PAYMENT_DEADLINE'
  /** The customer neither confirmed nor disputed within 48 hours. */
  | 'AUTO_CONFIRM'
  /** An M-Pesa PIN prompt nobody answered: mark it failed. */
  | 'PAYMENT_TIMEOUT';

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

/** What kind of problem an incident records. */
export type IncidentKind =
  | 'server_error' // a request failed with HTTP 500
  | 'timer_failed' // a timer gave up after repeated errors
  | 'timer_worker_error' // the timer worker itself crashed
  | 'mpesa'; // M-Pesa refused, failed, or sent something unexpected

/**
 * Problems the server noticed by itself, for the Engineering page, so
 * they're seen before a customer calls. The same problem happening again
 * adds to the open incident's count instead of a new row: one open
 * incident per fingerprint. Once resolved, a repeat opens a new one.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    /** Identifies "the same problem" (kind + where + what). */
    fingerprint: text('fingerprint').notNull(),
    kind: text('kind').$type<IncidentKind>().notNull(),
    title: text('title').notNull(),
    /** The latest occurrence: route, error stack, timer details… */
    detail: jsonb('detail'),
    jobId: text('job_id').references(() => jobs.id),
    lastRequestId: text('last_request_id'),
    count: integer('count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    status: text('status').$type<'OPEN' | 'RESOLVED'>().notNull(),
    resolvedBy: text('resolved_by').references(() => staff.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
  },
  t => [
    uniqueIndex('incidents_open_fingerprint_idx')
      .on(t.fingerprint)
      .where(sql`${t.status} = 'OPEN'`),
    index('incidents_last_seen_idx').on(t.lastSeenAt),
  ],
);

/**
 * The maintenance catalog (docs/job-flow.md §3.2), one row per saved
 * version: the latest is live. Every edit saves a whole new version with
 * who and why, so any old price can be looked up and a bad change undone.
 * With no rows, the starting catalog in src/domain/pricing/catalog.ts
 * applies. Booked jobs keep their price: their quote holds a copy.
 */
export const catalogVersions = pgTable(
  'catalog_versions',
  {
    id: text('id').primaryKey(),
    catalog: jsonb('catalog').$type<Catalog>().notNull(),
    /** What changed, in words, e.g. "Oil & filter change: prices". */
    summary: text('summary').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by').references(() => staff.id),
    createdAt: createdAt(),
  },
  t => [index('catalog_versions_created_idx').on(t.createdAt)],
);

/**
 * Staff notes on a job or an app user ("called her, she'll be home at 3"),
 * so whoever picks the case up next sees the story. Only ever added.
 */
export const supportNotes = pgTable(
  'support_notes',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').$type<'job' | 'user'>().notNull(),
    targetId: text('target_id').notNull(),
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  t => [index('support_notes_target_idx').on(t.targetType, t.targetId)],
);

/** What a ledger entry records (docs/ledger.md). */
export type LedgerEntryKind =
  | 'PAYMENT_RECEIVED' // M-Pesa confirmed money in: into the job's escrow
  | 'RELEASE' // escrow to the mechanic, minus Fundi-X commission
  | 'REFUND' // escrow back to the customer (owed until sent)
  | 'PAYOUT_SENT' // M-Pesa B2C paid the mechanic
  | 'REFUND_SENT'; // M-Pesa B2C paid the customer back

/**
 * The double-entry ledger (docs/ledger.md). Each entry is one money event;
 * its lines move amounts between accounts and always add up to zero, so
 * money is never created or lost. Rows are only ever added: the database
 * refuses edits and deletes, and refuses an entry that doesn't balance.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<LedgerEntryKind>().notNull(),
    jobId: text('job_id').references(() => jobs.id),
    paymentId: text('payment_id'),
    refundId: text('refund_id'),
    releaseId: text('release_id'),
    transferId: text('transfer_id'),
    description: text('description').notNull(),
    createdAt: createdAt(),
  },
  t => [index('ledger_entries_job_idx').on(t.jobId)],
);

/**
 * One side of an entry. `amount` is signed: positive is a debit (money
 * arriving in an asset, or a debt paid down), negative a credit. Account
 * names: mpesa, escrow:<jobId>, provider:<userId>, customer:<userId>,
 * revenue:<CALL_OUT|SERVICE|PARTS>.
 */
export const ledgerLines = pgTable(
  'ledger_lines',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => ledgerEntries.id),
    account: text('account').notNull(),
    amount: cents('amount'),
    createdAt: createdAt(),
  },
  t => [index('ledger_lines_account_idx').on(t.account), index('ledger_lines_entry_idx').on(t.entryId)],
);

/**
 * QUEUED: waiting for the transfer worker. SENDING: handed to M-Pesa, no
 * answer yet. SENT: M-Pesa accepted it; the result comes by callback.
 * SUCCESS: the money reached the phone. FAILED: needs a person (retry from
 * the admin portal once the cause is fixed).
 */
export type TransferStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'SUCCESS' | 'FAILED';

/**
 * Money going out through M-Pesa B2C (docs/mpesa.md): one per payout to a
 * mechanic and one per refund to a customer. Created in the same
 * transaction as the release or refund (an outbox), and sent afterwards by
 * the transfer worker, so a crash can never lose one or send one twice.
 */
export const transfers = pgTable(
  'transfers',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<'PAYOUT' | 'REFUND'>().notNull(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    releaseId: text('release_id'),
    refundId: text('refund_id'),
    /** The mechanic (PAYOUT) or customer (REFUND) receiving it. */
    recipientId: text('recipient_id').notNull(),
    phone: text('phone').notNull(),
    amount: cents('amount'),
    status: text('status').$type<TransferStatus>().notNull(),
    /** M-Pesa's id for the request, from its answer; matches the result callback. */
    conversationId: text('conversation_id'),
    /** M-Pesa's transaction code once the money arrived. */
    receiptNumber: text('receipt_number'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  t => [
    index('transfers_status_idx').on(t.status, t.nextAttemptAt),
    index('transfers_job_idx').on(t.jobId),
    uniqueIndex('transfers_conversation_idx').on(t.conversationId),
    uniqueIndex('transfers_release_idx').on(t.releaseId),
    uniqueIndex('transfers_refund_idx').on(t.refundId),
  ],
);

/**
 * A customer's saved places ("Home", "Work"), offered first when booking.
 * One of each kind per person; saving again replaces it. Deleted with the
 * account (personal data, not a record the books need).
 */
export const savedPlaces = pgTable(
  'saved_places',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').$type<'home' | 'work'>().notNull(),
    /** In the customer's words, e.g. "Kileleshwa, off Othaya Road". */
    address: text('address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('saved_places_user_kind_idx').on(t.userId, t.kind)],
);

/**
 * A customer's vehicles ("My vehicles"). A booking copies the vehicle into
 * the job, so editing or removing one never changes a past job or price.
 * Removing hides it (removed_at); the same car can be added again later.
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** As shown: upper case, single spaces ("KDA 123A"). */
    registration: text('registration').notNull(),
    /** Letters and digits only ("KDA123A"): one car, however it's typed. */
    registrationKey: text('registration_key').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year'),
    /** Decide the maintenance price class (with fuel), when known. */
    engineCc: integer('engine_cc'),
    fuel: text('fuel').$type<'petrol' | 'diesel' | 'hybrid' | 'electric'>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  t => [
    uniqueIndex('vehicles_user_registration_idx')
      .on(t.userId, t.registrationKey)
      .where(sql`removed_at is null`),
  ],
);
