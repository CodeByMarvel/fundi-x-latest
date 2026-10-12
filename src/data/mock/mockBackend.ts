import { BillingService } from '../../domain/billing/BillingService';
import { commissionOn } from '../../domain/billing/commission';
import {
  balanceDue,
  escrowTotal,
  MoneyMove,
  settlementFor,
} from '../../domain/billing/ledger';
import {
  Charge,
  MoneyPurpose,
  normaliseMpesaPhone,
  Payment,
  PaymentError,
  PaymentFailureReason,
  Refund,
  Release,
} from '../../domain/billing/types';
import { JobRepository } from '../../domain/jobs/JobRepository';
import {
  AUTO_CONFIRM_MS,
  CALL_OUT_PAYMENT_WINDOW_MS,
  isProviderLate,
  NO_SHOW_WAIT_MS,
  SERVICE_PAYMENT_WINDOW_MS,
} from '../../domain/jobs/rules';
import {
  applyTransition,
  isTerminalStatus,
  JobTransitionError,
} from '../../domain/jobs/transitions';
import {
  CreateJobInput,
  DisputeResolution,
  Job,
  JobActor,
  JobEvent,
  JobEventMetadata,
  JobStatus,
} from '../../domain/jobs/types';
import {
  PriceChangedError,
  PricingService,
} from '../../domain/pricing/PricingService';
import { ProviderRepository } from '../../domain/providers/ProviderRepository';
import {
  Provider,
  ReliabilityEvent,
  ReliabilityEventType,
} from '../../domain/providers/types';
import {
  AdditionalQuotePendingError,
  buildQuoteItems,
  hasPendingAdditionalQuote,
  QuoteValidationError,
  StaleQuoteError,
  sumItems,
  validateQuoteItems,
} from '../../domain/quotes/quotes';
import { Quote, QuoteItemInput } from '../../domain/quotes/types';
import { delay } from './delay';
import { calculateEstimate } from '../../domain/pricing/engine';
import { mockProviders } from './mockProviders';
import { startProviderBots } from './providerBots';

/** Until login exists, every job belongs to this customer. */
const MOCK_CUSTOMER_ID = 'customer-1';

// How long things take in the simulated world. Exported for tests.
export const NETWORK_MS = 500;
export const MATCHING_DELAY_MS = 1500;
/** If nobody is free, matching tries this many times before giving up. */
export const MAX_MATCHING_ROUNDS = 5;
export const OFFER_TIMEOUT_MS = 45_000;
export const ETA_TICK_MS = 5000;
export const STK_SEND_MS = 1200;
export const STK_TIMEOUT_MS = 60_000;
export const PAYMENT_PROCESSING_MS = 2000;
export const REFUND_PROCESSING_MS = 3000;
export const DISPUTE_REVIEW_MS = 15_000;

/** How the customer answers the simulated M-Pesa prompt on their phone. */
export type PhoneResponse = 'pay' | 'cancel' | 'insufficient_funds';

/** Dev-only: stands in for the customer's phone during M-Pesa payments. */
export type SimulatedPhone = {
  respondToPaymentPrompt(paymentId: string, response: PhoneResponse): void;
};

/** What support decides; who decided and when are filled in by the backend. */
export type DisputeDecision =
  | { outcome: 'REWORK'; note: string }
  | { outcome: 'UPHOLD_PROVIDER'; note: string }
  | {
      outcome: 'SPLIT';
      customerRefund: number;
      providerPayout: number;
      note: string;
    };

/** Dev-only: stands in for Fundi-X support's back-office tools. */
export type SimulatedSupport = {
  resolveDispute(jobId: string, decision: DisputeDecision): void;
};

export type MockBackend = {
  jobs: JobRepository;
  billing: BillingService;
  pricing: PricingService;
  providers: ProviderRepository;
  phone: SimulatedPhone;
  support: SimulatedSupport;
};

export type MockBackendOptions = {
  /** Providers the simulation plays itself. Tests leave this empty. */
  botProviderIds?: string[];
  /** Whether simulated support resolves disputes on its own. */
  autoResolveDisputes?: boolean;
};

/** Fields that may change alongside (or without) a status change. */
type JobChanges = Partial<
  Omit<Job, 'id' | 'customerId' | 'status' | 'createdAt' | 'updatedAt'>
>;

/**
 * An in-memory stand-in for the whole Fundi-X backend. Jobs, quotes, money
 * and providers share one store, the way they'd share one database, so e.g.
 * a successful payment can move its job on, and a job ending can move money
 * out of escrow.
 *
 * It lives outside React, so its data survives screens unmounting and
 * switching between the customer and mechanic sides. Built from closures
 * (not a class) so methods can be passed around without losing `this`.
 */
export function createMockBackend({
  botProviderIds = [],
  autoResolveDisputes = true,
}: MockBackendOptions = {}): MockBackend {
  const jobs = new Map<string, Job>();
  const events = new Map<string, JobEvent[]>();
  const quotes = new Map<string, Quote>();
  const providers = new Map(mockProviders.map(p => [p.id, { ...p }]));
  const matchingRounds = new Map<string, number>();
  const listeners = new Set<() => void>();
  let nextId = 1;

  // Rebuilt only when something changes, so readers get stable arrays.
  let jobList: readonly Job[] = [];
  let quoteList: readonly Quote[] = [];
  let providerList: readonly Provider[] = [...providers.values()];
  let charges: readonly Charge[] = [];
  let payments: readonly Payment[] = [];
  let refunds: readonly Refund[] = [];
  let releases: readonly Release[] = [];
  let reliabilityEvents: readonly ReliabilityEvent[] = [];

  const makeId = (prefix: string) => `${prefix}-${nextId++}`;
  const now = () => new Date().toISOString();
  const notify = () => listeners.forEach(listener => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /** Waits like a network call, then does the work. */
  const call = async <T>(work: () => T, ms = NETWORK_MS): Promise<T> => {
    await delay(ms);
    return work();
  };

  // ---- Storage ----

  const putJob = (job: Job) => {
    jobs.set(job.id, job);
    jobList = [...jobs.values()];
  };
  const putQuote = (quote: Quote) => {
    quotes.set(quote.id, quote);
    quoteList = [...quotes.values()];
  };
  const putProvider = (provider: Provider) => {
    providers.set(provider.id, provider);
    providerList = [...providers.values()];
  };
  /** Replaces a record in a list by id, or adds it. */
  const upsert = <T extends { id: string }>(list: readonly T[], record: T) =>
    list.some(r => r.id === record.id)
      ? list.map(r => (r.id === record.id ? record : r))
      : [...list, record];

  const addCharge = (
    jobId: string,
    purpose: MoneyPurpose,
    amount: number,
    description: string,
    quoteId?: string,
  ) => {
    charges = [
      ...charges,
      {
        id: makeId('chg'),
        jobId,
        purpose,
        amount,
        description,
        ...(quoteId && { quoteId }),
        createdAt: now(),
      },
    ];
  };

  const getJobOrThrow = (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    return job;
  };

  const getProviderOrThrow = (providerId: string) => {
    const provider = providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }
    return provider;
  };

  /** Throws unless `providerId` is the provider assigned to this job. */
  const assertProvider = (jobId: string, providerId: string) => {
    if (getJobOrThrow(jobId).providerId !== providerId) {
      throw new Error(`Job ${jobId} doesn't belong to ${providerId}`);
    }
  };

  /** Throws unless `jobId` is currently offered to `providerId`. */
  const assertOfferedTo = (jobId: string, providerId: string) => {
    if (getJobOrThrow(jobId).offeredProviderId !== providerId) {
      throw new Error(`Job ${jobId} is not offered to ${providerId}`);
    }
  };

  /**
   * Throws unless `quoteId` belongs to this job and is still open. For the
   * main quote it must also be the latest version.
   */
  const assertOpenQuote = (jobId: string, quoteId: string) => {
    const quote = quotes.get(quoteId);
    if (
      !quote ||
      quote.jobId !== jobId ||
      quote.status !== 'PENDING' ||
      (quote.kind === 'BASE' && getJobOrThrow(jobId).baseQuoteId !== quoteId)
    ) {
      throw new StaleQuoteError();
    }
    return quote;
  };

  const assertStatus = (jobId: string, status: JobStatus, actor: JobActor) => {
    const job = getJobOrThrow(jobId);
    if (job.status !== status) {
      throw new JobTransitionError(job.status, status, actor);
    }
    return job;
  };

  // ---- Escrow ----

  /** Starts returning a payment to the customer's M-Pesa. */
  const refundPayment = (
    payment: Payment,
    reason: string,
    amount = payment.amount,
  ) => {
    const at = now();
    const refund: Refund = {
      id: makeId('ref'),
      jobId: payment.jobId,
      paymentId: payment.id,
      amount,
      reason,
      status: 'PENDING',
      createdAt: at,
      updatedAt: at,
    };
    refunds = [...refunds, refund];
    setTimeout(() => {
      refunds = upsert(refunds, {
        ...refund,
        status: 'SUCCESS',
        updatedAt: now(),
      });
      notify();
    }, REFUND_PROCESSING_MS);
  };

  /**
   * Runs once, when a job ends. Decides refund vs release with the pure
   * settlementFor() rules, then records it. Every way a job can end comes
   * through here, so no ending can forget about the money.
   */
  const settle = (job: Job) => {
    const { refund, release } = settlementFor(job, payments);

    for (const move of refund) {
      refundPayment(
        move.payment,
        job.cancellation?.reason ?? 'job_closed',
        move.amount,
      );
    }
    if (release.length > 0 && job.providerId) {
      const lines = release.map(({ payment, amount }: MoneyMove) => ({
        paymentId: payment.id,
        purpose: payment.purpose,
        gross: amount,
        commission: commissionOn(amount, payment.purpose),
      }));
      const gross = lines.reduce((s, l) => s + l.gross, 0);
      const commission = lines.reduce((s, l) => s + l.commission, 0);
      releases = [
        ...releases,
        {
          id: makeId('rel'),
          jobId: job.id,
          providerId: job.providerId,
          lines,
          gross,
          commission,
          net: gross - commission,
          createdAt: now(),
        },
      ];
    }
  };

  // ---- Changing jobs ----

  /**
   * The only way a job's status changes. Rules are checked against the job
   * as it is *now*, which may differ from what the caller saw when it started.
   * `alsoSave` stores related records (e.g. a quote) in the same step, and a
   * job that ends is settled in the same step too, so listeners never see
   * one updated without the other.
   */
  const transitionJob = (
    jobId: string,
    to: JobStatus,
    actor: JobActor,
    {
      metadata,
      changes,
      alsoSave,
    }: {
      metadata?: JobEventMetadata;
      changes?: JobChanges;
      alsoSave?: () => void;
    } = {},
  ): Job => {
    const { job, event } = applyTransition(getJobOrThrow(jobId), to, actor, {
      now: now(),
      eventId: makeId('evt'),
      metadata,
    });
    // applyTransition already dropped fields the new status doesn't use.
    const next: Job = { ...job, ...changes };

    putJob(next);
    events.set(jobId, [...(events.get(jobId) ?? []), event]);
    alsoSave?.();
    if (isTerminalStatus(to)) {
      settle(next);
    }
    notify();
    return next;
  };

  /**
   * For changes that aren't status changes, like a new ETA or a rating.
   * These aren't lifecycle events, so nothing is added to the audit trail.
   */
  const updateJob = (jobId: string, changes: JobChanges) => {
    const next: Job = { ...getJobOrThrow(jobId), ...changes, updatedAt: now() };
    putJob(next);
    notify();
    return next;
  };

  const cancelledBy = (
    actor: JobActor,
    reason: NonNullable<Job['cancellation']>['reason'],
    fromStatus: JobStatus,
  ): JobChanges => ({ cancellation: { by: actor, reason, fromStatus } });

  /** A fact about a provider's reliability (docs/job-flow.md §13). */
  const recordReliability = (
    providerId: string,
    jobId: string,
    type: ReliabilityEventType,
  ) => {
    reliabilityEvents = [
      ...reliabilityEvents,
      { id: makeId('rel-evt'), providerId, jobId, type, at: now() },
    ];
  };

  // ---- Matching (the backend's own background work) ----

  /** Has an unfinished job, or is already considering another offer. */
  const isBusy = (providerId: string) =>
    jobList.some(
      job =>
        (job.providerId === providerId && !isTerminalStatus(job.status)) ||
        (job.status === 'OFFERED' && job.offeredProviderId === providerId),
    );

  /** Providers this job has already been offered to, in any earlier round. */
  const previouslyOffered = (jobId: string) =>
    (events.get(jobId) ?? [])
      .filter(e => e.toStatus === 'OFFERED')
      .map(e => e.metadata?.providerId);

  const startMatching = (jobId: string) => {
    setTimeout(() => matchOnce(jobId), MATCHING_DELAY_MS);
  };

  /**
   * Offers the job to the nearest free, online provider who hasn't been
   * asked yet. If nobody is free right now, tries again a few times; if
   * everyone has already said no, gives up straight away (and settlement
   * refunds the call-out).
   */
  const matchOnce = (jobId: string) => {
    // The job may have been cancelled while we were "searching".
    if (jobs.get(jobId)?.status !== 'SEARCHING') {
      return;
    }
    const asked = previouslyOffered(jobId);
    const notAsked = providerList.filter(p => !asked.includes(p.id));
    const [provider] = notAsked
      .filter(p => p.online && !isBusy(p.id))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    if (!provider) {
      const rounds = (matchingRounds.get(jobId) ?? 0) + 1;
      matchingRounds.set(jobId, rounds);
      if (notAsked.length > 0 && rounds < MAX_MATCHING_ROUNDS) {
        startMatching(jobId);
        return;
      }
      transitionJob(jobId, 'CANCELLED', 'SYSTEM', {
        metadata: { reason: 'no_provider_available' },
        changes: cancelledBy('SYSTEM', 'no_provider_available', 'SEARCHING'),
      });
      return;
    }

    const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_MS).toISOString();
    transitionJob(jobId, 'OFFERED', 'SYSTEM', {
      metadata: { providerId: provider.id },
      changes: { offeredProviderId: provider.id, offerExpiresAt: expiresAt },
    });

    setTimeout(() => {
      const job = jobs.get(jobId);
      // Already answered, or this is a later offer with its own timer.
      if (
        job?.status !== 'OFFERED' ||
        job.offeredProviderId !== provider.id ||
        job.offerExpiresAt !== expiresAt
      ) {
        return;
      }
      recordReliability(provider.id, jobId, 'offer_expired');
      transitionJob(jobId, 'SEARCHING', 'SYSTEM', {
        metadata: { providerId: provider.id, reason: 'offer_expired' },
      });
      startMatching(jobId);
    }, OFFER_TIMEOUT_MS);
  };

  // ---- Timers for decided business rules ----

  const isInFlight = (p: Payment) =>
    p.status === 'PENDING' || p.status === 'PROCESSING';

  /** Unpaid bookings close after 30 minutes (unless a payment is running). */
  const scheduleCallOutDeadline = (
    jobId: string,
    ms = CALL_OUT_PAYMENT_WINDOW_MS,
  ) => {
    setTimeout(() => {
      if (jobs.get(jobId)?.status !== 'CALL_OUT_PAYMENT_PENDING') {
        return;
      }
      if (payments.some(p => p.jobId === jobId && isInFlight(p))) {
        // Don't cut off a customer who is entering their PIN right now.
        scheduleCallOutDeadline(jobId, STK_TIMEOUT_MS);
        return;
      }
      transitionJob(jobId, 'CANCELLED', 'SYSTEM', {
        metadata: { reason: 'call_out_unpaid' },
        changes: cancelledBy(
          'SYSTEM',
          'call_out_unpaid',
          'CALL_OUT_PAYMENT_PENDING',
        ),
      });
    }, ms);
  };

  /** The agreed price must reach escrow within 30 minutes of being due. */
  const scheduleServicePaymentDeadline = (
    jobId: string,
    ms = SERVICE_PAYMENT_WINDOW_MS,
  ) => {
    setTimeout(() => {
      if (jobs.get(jobId)?.status !== 'SERVICE_PAYMENT_PENDING') {
        return;
      }
      if (payments.some(p => p.jobId === jobId && isInFlight(p))) {
        scheduleServicePaymentDeadline(jobId, STK_TIMEOUT_MS);
        return;
      }
      transitionJob(jobId, 'CANCELLED', 'SYSTEM', {
        metadata: { reason: 'service_unpaid' },
        changes: cancelledBy(
          'SYSTEM',
          'service_unpaid',
          'SERVICE_PAYMENT_PENDING',
        ),
      });
    }, ms);
  };

  /** A customer who doesn't confirm or dispute within 48 h is taken to confirm. */
  const scheduleAutoConfirm = (job: Job) => {
    const enteredAt = job.updatedAt;
    setTimeout(() => {
      const current = jobs.get(job.id);
      // Moved on, or this is a later round (after a dispute) with its own timer.
      if (
        current?.status !== 'AWAITING_CONFIRMATION' ||
        current.updatedAt !== enteredAt
      ) {
        return;
      }
      transitionJob(job.id, 'COMPLETED', 'SYSTEM', {
        metadata: { reason: 'auto_confirmed' },
        changes: { completedAt: now() },
      });
    }, AUTO_CONFIRM_MS);
  };

  /** Counts the ETA down while the provider drives over. */
  const startEtaCountdown = (jobId: string) => {
    const timer = setInterval(() => {
      const job = jobs.get(jobId);
      if (job?.status !== 'EN_ROUTE') {
        clearInterval(timer);
        return;
      }
      if ((job.etaMinutes ?? 0) > 1) {
        updateJob(jobId, { etaMinutes: job.etaMinutes! - 1 });
      }
    }, ETA_TICK_MS);
  };

  /** Simulated support always sends the provider back to fix it. */
  const scheduleDisputeReview = (jobId: string) => {
    setTimeout(() => {
      if (jobs.get(jobId)?.status !== 'DISPUTED') {
        return;
      }
      support.resolveDispute(jobId, {
        outcome: 'REWORK',
        note: 'Fundi-X support reviewed your report and asked your fundi to fix the problem at no extra cost.',
      });
    }, DISPUTE_REVIEW_MS);
  };

  // ---- Quotes ----

  const newQuote = (
    jobId: string,
    fields: Pick<Quote, 'kind' | 'issuedBy' | 'version' | 'status'> & {
      providerId?: string;
      note?: string;
      reason?: string;
      respondedAt?: string;
    },
    inputs: QuoteItemInput[],
  ): Quote => {
    const { note, reason, ...rest } = fields;
    const items = buildQuoteItems(inputs, () => makeId('item'));
    return {
      ...rest,
      ...(note?.trim() && { note: note.trim() }),
      ...(reason?.trim() && { reason: reason.trim() }),
      id: makeId('quote'),
      jobId,
      items,
      total: sumItems(items),
      createdAt: now(),
    };
  };

  /** An approved quote becomes something the customer owes. */
  const chargeForQuote = (quote: Quote) =>
    addCharge(
      quote.jobId,
      'SERVICE',
      quote.total,
      quote.kind === 'BASE' ? 'Agreed work' : `Additional: ${quote.reason}`,
      quote.id,
    );

  // ---- Jobs ----

  const jobRepository: JobRepository = {
    createJob: (input: CreateJobInput) =>
      call(() => {
        const { acceptedPrice, ...details } = input;
        // Never trust a price from the app: recalculate it here.
        const estimate = calculateEstimate(details);
        if (
          estimate.callOut !== acceptedPrice.callOut ||
          estimate.fixedService?.total !== acceptedPrice.fixedServiceTotal
        ) {
          throw new PriceChangedError();
        }

        const at = now();
        const job: Job = {
          ...details,
          id: makeId('job'),
          customerId: MOCK_CUSTOMER_ID,
          pricingMode: estimate.pricingMode,
          status: 'CALL_OUT_PAYMENT_PENDING',
          createdAt: at,
          updatedAt: at,
        };

        addCharge(
          job.id,
          'CALL_OUT',
          estimate.callOut,
          'Call-out (transport & inspection)',
        );
        if (estimate.fixedService) {
          // The customer accepted this price when booking.
          const quote = newQuote(
            job.id,
            {
              kind: 'BASE',
              issuedBy: 'FUNDI_X',
              version: 1,
              status: 'APPROVED',
              note: estimate.fixedService.packageName,
              respondedAt: at,
            },
            estimate.fixedService.items,
          );
          putQuote(quote);
          chargeForQuote(quote);
          job.baseQuoteId = quote.id;
        }

        putJob(job);
        events.set(job.id, [
          {
            id: makeId('evt'),
            jobId: job.id,
            fromStatus: null,
            toStatus: 'CALL_OUT_PAYMENT_PENDING',
            actor: 'CUSTOMER',
            createdAt: at,
            metadata: {
              callOut: estimate.callOut,
              fixedServiceTotal: estimate.fixedService?.total ?? null,
            },
          },
        ]);
        notify();
        scheduleCallOutDeadline(job.id);
        return job;
      }),

    cancelJob: jobId =>
      call(() => {
        const job = getJobOrThrow(jobId);
        // Decided now, from the clock: a provider arriving later can't undo it.
        const late = isProviderLate(job, Date.now());
        if (late && job.providerId) {
          recordReliability(job.providerId, jobId, 'late');
        }
        return transitionJob(jobId, 'CANCELLED', 'CUSTOMER', {
          changes: cancelledBy(
            'CUSTOMER',
            late ? 'provider_late' : 'customer_cancelled',
            job.status,
          ),
        });
      }),

    approveQuote: (jobId, quoteId) =>
      call(() => {
        const quote = assertOpenQuote(jobId, quoteId);
        const approved: Quote = {
          ...quote,
          status: 'APPROVED',
          respondedAt: now(),
        };

        if (quote.kind === 'ADDITIONAL') {
          throw new Error('Extra work is approved by paying for it');
        }
        // Approved: next the price goes into escrow, before work starts.
        const job = transitionJob(
          jobId,
          'SERVICE_PAYMENT_PENDING',
          'CUSTOMER',
          {
            metadata: { quoteId, total: quote.total },
            alsoSave: () => {
              putQuote(approved);
              chargeForQuote(approved);
            },
          },
        );
        scheduleServicePaymentDeadline(jobId);
        return job;
      }),

    rejectQuote: (jobId, quoteId) =>
      call(() => {
        const quote = assertOpenQuote(jobId, quoteId);
        const rejected: Quote = {
          ...quote,
          status: 'REJECTED',
          respondedAt: now(),
        };

        if (quote.kind === 'ADDITIONAL') {
          putQuote(rejected);
          notify();
          return getJobOrThrow(jobId);
        }
        // Declining the main quote ends the job; the call-out paid for the visit.
        return transitionJob(jobId, 'CANCELLED', 'CUSTOMER', {
          metadata: { quoteId },
          changes: cancelledBy('CUSTOMER', 'quote_declined', 'QUOTE_SENT'),
          alsoSave: () => putQuote(rejected),
        });
      }),

    confirmCompletion: jobId =>
      call(() =>
        // The money is already in escrow: confirming releases it.
        transitionJob(jobId, 'COMPLETED', 'CUSTOMER', {
          changes: { completedAt: now() },
        }),
      ),

    disputeCompletion: (jobId, reason) =>
      call(() => {
        if (!reason.trim()) {
          throw new Error('Tell us what went wrong');
        }
        const job = transitionJob(jobId, 'DISPUTED', 'CUSTOMER', {
          metadata: { reason: reason.trim() },
          changes: { dispute: { reason: reason.trim() } },
        });
        if (autoResolveDisputes) {
          scheduleDisputeReview(jobId);
        }
        return job;
      }),

    submitRating: (jobId, stars, comment) =>
      call(() => {
        const job = getJobOrThrow(jobId);
        if (job.status !== 'COMPLETED' || job.rating) {
          throw new Error('This job can no longer be rated');
        }
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
          throw new Error('Pick between 1 and 5 stars');
        }
        if (job.providerId) {
          const provider = getProviderOrThrow(job.providerId);
          const count = provider.ratingCount + 1;
          const average =
            (provider.rating * provider.ratingCount + stars) / count;
          putProvider({
            ...provider,
            ratingCount: count,
            rating: Math.round(average * 10) / 10,
          });
        }
        return updateJob(jobId, {
          rating: { stars, comment: comment.trim(), createdAt: now() },
        });
      }),

    acceptOffer: (jobId, providerId) =>
      call(() => {
        assertOfferedTo(jobId, providerId);
        matchingRounds.delete(jobId);
        return transitionJob(jobId, 'ACCEPTED', 'PROVIDER', {
          metadata: { providerId },
          changes: { providerId },
        });
      }),

    declineOffer: (jobId, providerId) =>
      call(() => {
        assertOfferedTo(jobId, providerId);
        recordReliability(providerId, jobId, 'offer_declined');
        const job = transitionJob(jobId, 'SEARCHING', 'PROVIDER', {
          metadata: { providerId, reason: 'declined' },
        });
        startMatching(jobId);
        return job;
      }),

    withdrawFromJob: (jobId, providerId, note) =>
      call(() => {
        assertProvider(jobId, providerId);
        recordReliability(
          providerId,
          jobId,
          getJobOrThrow(jobId).status === 'EN_ROUTE'
            ? 'withdrew_en_route'
            : 'withdrew_after_accepting',
        );
        const job = transitionJob(jobId, 'SEARCHING', 'PROVIDER', {
          metadata: { providerId, reason: 'provider_withdrew' },
          changes: {
            reassignment: {
              providerId,
              ...(note.trim() && { note: note.trim() }),
              at: now(),
            },
          },
        });
        // The call-out stays in escrow while we find someone else.
        startMatching(jobId);
        return job;
      }),

    startTrip: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        const { distanceKm } = getProviderOrThrow(providerId);
        const etaMinutes = Math.max(3, Math.round(distanceKm * 5));
        const job = transitionJob(jobId, 'EN_ROUTE', 'PROVIDER', {
          changes: {
            etaMinutes,
            // The promise the late rule is measured against.
            expectedArrivalAt: new Date(
              Date.now() + etaMinutes * 60_000,
            ).toISOString(),
          },
        });
        startEtaCountdown(jobId);
        return job;
      }),

    markArrived: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        return transitionJob(jobId, 'ARRIVED', 'PROVIDER', {
          changes: { arrivedAt: now() },
        });
      }),

    startInspection: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        return transitionJob(jobId, 'DIAGNOSING', 'PROVIDER');
      }),

    readyToStart: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        const job = transitionJob(jobId, 'SERVICE_PAYMENT_PENDING', 'PROVIDER');
        scheduleServicePaymentDeadline(jobId);
        return job;
      }),

    reportCustomerNoShow: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        const job = assertStatus(jobId, 'ARRIVED', 'PROVIDER');
        const waited = Date.now() - Date.parse(job.arrivedAt ?? job.updatedAt);
        if (waited < NO_SHOW_WAIT_MS) {
          throw new Error('Wait 15 minutes at the location first');
        }
        return transitionJob(jobId, 'CANCELLED', 'PROVIDER', {
          metadata: { reason: 'customer_no_show' },
          changes: cancelledBy('PROVIDER', 'customer_no_show', 'ARRIVED'),
        });
      }),

    sendQuote: (jobId, providerId, inputs, note) =>
      call(() => {
        assertProvider(jobId, providerId);
        validateQuoteItems(inputs);
        const job = getJobOrThrow(jobId);
        const previous = job.baseQuoteId
          ? quotes.get(job.baseQuoteId)
          : undefined;
        const quote = newQuote(
          jobId,
          {
            kind: 'BASE',
            issuedBy: 'PROVIDER',
            providerId,
            version: (previous?.version ?? 0) + 1,
            status: 'PENDING',
            note,
          },
          inputs,
        );
        transitionJob(jobId, 'QUOTE_SENT', 'PROVIDER', {
          metadata: { quoteId: quote.id, total: quote.total },
          changes: { baseQuoteId: quote.id },
          alsoSave: () => putQuote(quote),
        });
        return quote;
      }),

    reviseQuote: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        const quote = assertOpenQuote(
          jobId,
          getJobOrThrow(jobId).baseQuoteId ?? '',
        );
        return transitionJob(jobId, 'DIAGNOSING', 'PROVIDER', {
          metadata: { quoteId: quote.id, reason: 'revising_quote' },
          alsoSave: () => putQuote({ ...quote, status: 'SUPERSEDED' }),
        });
      }),

    raiseAdditionalQuote: (jobId, providerId, inputs, reason) =>
      call(() => {
        assertProvider(jobId, providerId);
        assertStatus(jobId, 'IN_PROGRESS', 'PROVIDER');
        if (!reason.trim()) {
          throw new QuoteValidationError('Say why the extra work is needed.');
        }
        validateQuoteItems(inputs);
        const quote = newQuote(
          jobId,
          {
            kind: 'ADDITIONAL',
            issuedBy: 'PROVIDER',
            providerId,
            version: 1,
            status: 'PENDING',
            reason,
          },
          inputs,
        );
        putQuote(quote);
        notify();
        return quote;
      }),

    markWorkComplete: (jobId, providerId, summary) =>
      call(() => {
        assertProvider(jobId, providerId);
        // A business rule across two records (job + quotes), so it's
        // enforced here rather than in the transition table.
        if (hasPendingAdditionalQuote(quoteList, jobId)) {
          throw new AdditionalQuotePendingError();
        }
        const job = transitionJob(jobId, 'AWAITING_CONFIRMATION', 'PROVIDER', {
          changes: { workSummary: summary.trim() || undefined },
        });
        scheduleAutoConfirm(job);
        return job;
      }),

    getJob: jobId => call(() => jobs.get(jobId), 300),
    getJobEvents: jobId => call(() => events.get(jobId) ?? [], 300),
    getJobSnapshot: jobId => jobs.get(jobId),
    getJobsSnapshot: () => jobList,
    getQuoteSnapshot: quoteId => quotes.get(quoteId),
    getQuotesSnapshot: () => quoteList,
    subscribe,
  };

  // ---- Payments ----

  const updatePayment = (paymentId: string, changes: Partial<Payment>) => {
    const current = payments.find(p => p.id === paymentId)!;
    const next: Payment = { ...current, ...changes, updatedAt: now() };
    payments = upsert(payments, next);
    notify();
    return next;
  };

  const failPayment = (paymentId: string, reason: PaymentFailureReason) =>
    updatePayment(paymentId, { status: 'FAILED', failureReason: reason });

  /** Looks like a real M-Pesa code: "S" and nine letters or digits. */
  const makeReceiptNumber = () =>
    'S' +
    Array.from(
      { length: 9 },
      () =>
        'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 34)],
    ).join('');

  /** M-Pesa confirmed the money: it's in escrow. Move the job on. */
  const settlePayment = (paymentId: string) => {
    const payment = updatePayment(paymentId, {
      status: 'SUCCESS',
      receiptNumber: makeReceiptNumber(),
    });
    const job = getJobOrThrow(payment.jobId);
    const metadata = { paymentId, receiptNumber: payment.receiptNumber! };

    if (
      payment.purpose === 'CALL_OUT' &&
      job.status === 'CALL_OUT_PAYMENT_PENDING'
    ) {
      transitionJob(job.id, 'SEARCHING', 'SYSTEM', { metadata });
      startMatching(job.id);
    } else if (
      payment.purpose === 'SERVICE' &&
      !payment.quoteId &&
      job.status === 'SERVICE_PAYMENT_PENDING'
    ) {
      // The agreed price is in escrow: work can start.
      transitionJob(job.id, 'IN_PROGRESS', 'SYSTEM', { metadata });
    } else if (
      payment.quoteId &&
      job.status === 'IN_PROGRESS' &&
      quotes.get(payment.quoteId)?.status === 'PENDING'
    ) {
      // Approve-and-pay: the extra work is approved once it's paid for.
      const approved: Quote = {
        ...quotes.get(payment.quoteId)!,
        status: 'APPROVED',
        respondedAt: now(),
      };
      putQuote(approved);
      chargeForQuote(approved);
      notify();
    } else {
      // The job moved on while the customer was paying (e.g. they cancelled
      // the booking with the PIN prompt still open). Give the money back.
      refundPayment(payment, 'job_closed_before_payment');
      notify();
    }
  };

  const billing: BillingService = {
    initiatePayment: async (jobId, phoneInput, options = {}) => {
      const phone = normaliseMpesaPhone(phoneInput);
      if (!phone) {
        throw new PaymentError(
          'Enter a valid M-Pesa number, e.g. 0712 345 678.',
        );
      }
      await delay(STK_SEND_MS);

      const job = jobs.get(jobId);
      // The backend, not the app, decides what this payment is for and how
      // much it is.
      let purpose: MoneyPurpose | undefined;
      let amount = 0;
      if (options.quoteId) {
        if (job?.status !== 'IN_PROGRESS') {
          throw new PaymentError(
            'Extra work can only be paid for while work is in progress.',
          );
        }
        const quote = assertOpenQuote(jobId, options.quoteId);
        if (quote.kind !== 'ADDITIONAL') {
          throw new PaymentError('Only extra-work quotes are paid this way.');
        }
        purpose = 'SERVICE';
        amount = quote.total;
      } else if (job?.status === 'CALL_OUT_PAYMENT_PENDING') {
        purpose = 'CALL_OUT';
        amount = balanceDue(charges, payments, jobId, purpose);
      } else if (job?.status === 'SERVICE_PAYMENT_PENDING') {
        purpose = 'SERVICE';
        amount = balanceDue(charges, payments, jobId, purpose);
      }
      if (!job || !purpose) {
        throw new PaymentError('This job is not waiting for payment.');
      }
      if (amount <= 0) {
        throw new PaymentError('There is nothing to pay right now.');
      }
      if (payments.some(p => p.jobId === jobId && isInFlight(p))) {
        throw new PaymentError(
          'A payment for this job is already in progress.',
        );
      }

      const at = now();
      const payment: Payment = {
        id: makeId('pay'),
        jobId,
        purpose,
        ...(options.quoteId && { quoteId: options.quoteId }),
        method: 'MPESA',
        phone,
        amount,
        status: 'PENDING',
        createdAt: at,
        updatedAt: at,
      };
      payments = [...payments, payment];
      notify();

      // Like M-Pesa, give up if the customer never answers the prompt.
      setTimeout(() => {
        if (payments.find(p => p.id === payment.id)?.status === 'PENDING') {
          failPayment(payment.id, 'timeout');
        }
      }, STK_TIMEOUT_MS);
      return payment;
    },
    getPaymentSnapshot: paymentId => payments.find(p => p.id === paymentId),
    getChargesSnapshot: () => charges,
    getPaymentsSnapshot: () => payments,
    getRefundsSnapshot: () => refunds,
    getReleasesSnapshot: () => releases,
    subscribe,
  };

  const phone: SimulatedPhone = {
    respondToPaymentPrompt(paymentId, response) {
      if (payments.find(p => p.id === paymentId)?.status !== 'PENDING') {
        return;
      }
      if (response === 'cancel') {
        failPayment(paymentId, 'cancelled_by_user');
        return;
      }
      updatePayment(paymentId, { status: 'PROCESSING' });
      setTimeout(() => {
        if (response === 'insufficient_funds') {
          failPayment(paymentId, 'insufficient_funds');
        } else {
          settlePayment(paymentId);
        }
      }, PAYMENT_PROCESSING_MS);
    },
  };

  // ---- Pricing ----

  const pricing: PricingService = {
    estimate: details => call(() => calculateEstimate(details), 400),
  };

  // ---- Providers ----

  const providerRepository: ProviderRepository = {
    setOnline: (providerId, online) =>
      call(() => {
        const provider = { ...getProviderOrThrow(providerId), online };
        putProvider(provider);
        notify();
        return provider;
      }, 300),
    getProviderSnapshot: providerId => providers.get(providerId),
    getProvidersSnapshot: () => providerList,
    getReliabilityEventsSnapshot: () => reliabilityEvents,
    subscribe,
  };

  // ---- Support (dev-only stand-in for the back office) ----

  const support: SimulatedSupport = {
    resolveDispute(jobId, decision) {
      const job = getJobOrThrow(jobId);
      if (job.status !== 'DISPUTED' || !job.dispute) {
        throw new JobTransitionError(job.status, 'DISPUTED', 'SYSTEM');
      }
      const resolution = {
        ...decision,
        decidedBy: 'support-sim',
        at: now(),
      } as DisputeResolution;
      const dispute = { ...job.dispute, resolution };
      const metadata = { resolution: decision.outcome };

      if (decision.outcome === 'REWORK') {
        if (job.providerId) {
          recordReliability(job.providerId, jobId, 'dispute_rework');
        }
        transitionJob(jobId, 'IN_PROGRESS', 'SYSTEM', {
          metadata,
          changes: { dispute },
        });
        return;
      }
      if (decision.outcome === 'UPHOLD_PROVIDER') {
        transitionJob(jobId, 'COMPLETED', 'SYSTEM', {
          metadata,
          changes: { dispute, completedAt: now() },
        });
        return;
      }
      // SPLIT: the two parts must add up to exactly what's in escrow.
      const { customerRefund, providerPayout } = decision;
      const whole = [customerRefund, providerPayout].every(
        n => Number.isInteger(n) && n >= 0,
      );
      if (
        !whole ||
        customerRefund + providerPayout !== escrowTotal(payments, jobId)
      ) {
        throw new Error('A split must divide exactly what is in escrow');
      }
      if (customerRefund > 0 && job.providerId) {
        recordReliability(job.providerId, jobId, 'dispute_split');
      }
      transitionJob(jobId, 'CANCELLED', 'SYSTEM', {
        metadata,
        changes: {
          dispute,
          ...cancelledBy('SYSTEM', 'dispute_resolved', 'DISPUTED'),
        },
      });
    },
  };

  if (botProviderIds.length > 0) {
    startProviderBots(jobRepository, botProviderIds);
  }

  return {
    jobs: jobRepository,
    billing,
    pricing,
    providers: providerRepository,
    phone,
    support,
  };
}
