import { JobRepository } from '../../domain/jobs/JobRepository';
import {
  applyTransition,
  isTerminalStatus,
} from '../../domain/jobs/transitions';
import {
  CreateJobInput,
  Job,
  JobActor,
  JobEvent,
  JobEventMetadata,
  JobStatus,
} from '../../domain/jobs/types';
import { PaymentService } from '../../domain/payments/PaymentService';
import {
  normaliseMpesaPhone,
  Payment,
  PaymentError,
  PaymentFailureReason,
} from '../../domain/payments/types';
import { ProviderRepository } from '../../domain/providers/ProviderRepository';
import { Provider } from '../../domain/providers/types';
import {
  buildQuoteItems,
  feeTotal,
  StaleQuoteError,
  sumItems,
  validateQuoteItems,
} from '../../domain/quotes/quotes';
import { Quote } from '../../domain/quotes/types';
import { delay } from './delay';
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
export const PAID_TO_COMPLETED_MS = 1000;
export const DISPUTE_REVIEW_MS = 15_000;

/** How the customer answers the simulated M-Pesa prompt on their phone. */
export type PhoneResponse = 'pay' | 'cancel' | 'insufficient_funds';

/** Dev-only: stands in for the customer's phone during M-Pesa payments. */
export type SimulatedPhone = {
  respondToPaymentPrompt(paymentId: string, response: PhoneResponse): void;
};

export type MockBackend = {
  jobs: JobRepository;
  payments: PaymentService;
  providers: ProviderRepository;
  phone: SimulatedPhone;
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
 * An in-memory stand-in for the whole Fundi-X backend. Jobs, quotes,
 * payments and providers share one store, the way they'd share one database,
 * so e.g. a successful payment can move its job to PAID.
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
  const payments = new Map<string, Payment>();
  const providers = new Map(mockProviders.map(p => [p.id, { ...p }]));
  const matchingRounds = new Map<string, number>();
  const listeners = new Set<() => void>();
  let nextId = 1;

  // Rebuilt only when something changes, so readers get stable arrays.
  let jobList: readonly Job[] = [];
  let paymentList: readonly Payment[] = [];
  let providerList: readonly Provider[] = [...providers.values()];

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
  const putPayment = (payment: Payment) => {
    payments.set(payment.id, payment);
    paymentList = [...payments.values()];
  };
  const putProvider = (provider: Provider) => {
    providers.set(provider.id, provider);
    providerList = [...providers.values()];
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

  /** Throws unless `providerId` is the provider who took this job. */
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

  /** Throws unless `quoteId` is the job's current, still-open quote. */
  const assertCurrentQuote = (jobId: string, quoteId: string) => {
    const quote = quotes.get(quoteId);
    if (
      getJobOrThrow(jobId).quoteId !== quoteId ||
      quote?.status !== 'PENDING'
    ) {
      throw new StaleQuoteError();
    }
    return quote;
  };

  // ---- Changing jobs ----

  /**
   * The only way a job's status changes. Rules are checked against the job
   * as it is *now*, which may differ from what the caller saw when it started.
   * `alsoSave` stores related records (e.g. a quote) in the same step, so
   * listeners never see one updated without the other.
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
    const next: Job = { ...job, ...changes };
    if (to !== 'OFFERED') {
      delete next.offeredProviderId;
      delete next.offerExpiresAt;
    }
    if (to !== 'EN_ROUTE') {
      delete next.etaMinutes;
    }

    putJob(next);
    events.set(jobId, [...(events.get(jobId) ?? []), event]);
    alsoSave?.();
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
   * everyone has already said no, gives up straight away.
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
        changes: {
          cancellation: { by: 'SYSTEM', reason: 'no_provider_available' },
        },
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
      transitionJob(jobId, 'SEARCHING', 'SYSTEM', {
        metadata: { providerId: provider.id, reason: 'offer_expired' },
      });
      startMatching(jobId);
    }, OFFER_TIMEOUT_MS);
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

  const scheduleDisputeReview = (jobId: string) => {
    setTimeout(() => {
      const job = jobs.get(jobId);
      if (job?.status !== 'DISPUTED' || !job.dispute) {
        return;
      }
      transitionJob(jobId, 'IN_PROGRESS', 'SYSTEM', {
        metadata: { resolution: 'rework' },
        changes: {
          dispute: {
            ...job.dispute,
            resolution:
              'Fundi-X support reviewed your report and asked your fundi to fix the problem at no extra cost.',
          },
        },
      });
    }, DISPUTE_REVIEW_MS);
  };

  // ---- Jobs ----

  const jobRepository: JobRepository = {
    createJob: (input: CreateJobInput) =>
      call(() => {
        const at = now();
        const job: Job = {
          ...input,
          id: makeId('job'),
          customerId: MOCK_CUSTOMER_ID,
          status: 'SEARCHING',
          createdAt: at,
          updatedAt: at,
        };
        putJob(job);
        events.set(job.id, [
          {
            id: makeId('evt'),
            jobId: job.id,
            fromStatus: null,
            toStatus: 'SEARCHING',
            actor: 'CUSTOMER',
            createdAt: at,
          },
        ]);
        notify();
        startMatching(job.id);
        return job;
      }),

    cancelJob: jobId =>
      call(() =>
        transitionJob(jobId, 'CANCELLED', 'CUSTOMER', {
          changes: {
            cancellation: { by: 'CUSTOMER', reason: 'customer_cancelled' },
          },
        }),
      ),

    approveQuote: (jobId, quoteId) =>
      call(() => {
        const quote = assertCurrentQuote(jobId, quoteId);
        return transitionJob(jobId, 'IN_PROGRESS', 'CUSTOMER', {
          metadata: { quoteId, total: quote.total },
          alsoSave: () =>
            quotes.set(quoteId, {
              ...quote,
              status: 'APPROVED',
              respondedAt: now(),
            }),
        });
      }),

    rejectQuote: (jobId, quoteId) =>
      call(() => {
        const quote = assertCurrentQuote(jobId, quoteId);
        const fee = feeTotal(quote.items);
        const markRejected = () =>
          quotes.set(quoteId, {
            ...quote,
            status: 'REJECTED',
            respondedAt: now(),
          });

        if (fee > 0) {
          return transitionJob(jobId, 'PAYMENT_PENDING', 'CUSTOMER', {
            metadata: { quoteId, amountDue: fee },
            changes: { amountDue: fee, chargeType: 'INSPECTION_ONLY' },
            alsoSave: markRejected,
          });
        }
        return transitionJob(jobId, 'CANCELLED', 'CUSTOMER', {
          metadata: { quoteId },
          changes: {
            cancellation: { by: 'CUSTOMER', reason: 'quote_rejected' },
          },
          alsoSave: markRejected,
        });
      }),

    confirmCompletion: jobId =>
      call(() => {
        const job = getJobOrThrow(jobId);
        const quote = job.quoteId ? quotes.get(job.quoteId) : undefined;
        if (quote?.status !== 'APPROVED') {
          throw new Error(`Job ${jobId} has no approved quote`);
        }
        return transitionJob(jobId, 'PAYMENT_PENDING', 'CUSTOMER', {
          metadata: { amountDue: quote.total },
          changes: { amountDue: quote.total, chargeType: 'FULL' },
        });
      }),

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
        const job = transitionJob(jobId, 'SEARCHING', 'PROVIDER', {
          metadata: { providerId, reason: 'declined' },
        });
        startMatching(jobId);
        return job;
      }),

    startTrip: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        const { distanceKm } = getProviderOrThrow(providerId);
        const job = transitionJob(jobId, 'EN_ROUTE', 'PROVIDER', {
          changes: { etaMinutes: Math.max(3, Math.round(distanceKm * 5)) },
        });
        startEtaCountdown(jobId);
        return job;
      }),

    markArrived: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        return transitionJob(jobId, 'ARRIVED', 'PROVIDER');
      }),

    startInspection: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        return transitionJob(jobId, 'DIAGNOSING', 'PROVIDER');
      }),

    sendQuote: (jobId, providerId, inputs, note) =>
      call(() => {
        assertProvider(jobId, providerId);
        validateQuoteItems(inputs);
        const job = getJobOrThrow(jobId);
        const previous = job.quoteId ? quotes.get(job.quoteId) : undefined;
        const items = buildQuoteItems(inputs, () => makeId('item'));
        const quote: Quote = {
          id: makeId('quote'),
          jobId,
          providerId,
          version: (previous?.version ?? 0) + 1,
          status: 'PENDING',
          items,
          total: sumItems(items),
          ...(note?.trim() && { note: note.trim() }),
          createdAt: now(),
        };
        transitionJob(jobId, 'QUOTE_SENT', 'PROVIDER', {
          metadata: { quoteId: quote.id, total: quote.total },
          changes: { quoteId: quote.id },
          alsoSave: () => quotes.set(quote.id, quote),
        });
        return quote;
      }),

    reviseQuote: (jobId, providerId) =>
      call(() => {
        assertProvider(jobId, providerId);
        const job = getJobOrThrow(jobId);
        const quote = assertCurrentQuote(jobId, job.quoteId ?? '');
        return transitionJob(jobId, 'DIAGNOSING', 'PROVIDER', {
          metadata: { quoteId: quote.id, reason: 'revising_quote' },
          alsoSave: () =>
            quotes.set(quote.id, { ...quote, status: 'SUPERSEDED' }),
        });
      }),

    markWorkComplete: (jobId, providerId, summary) =>
      call(() => {
        assertProvider(jobId, providerId);
        return transitionJob(jobId, 'AWAITING_CONFIRMATION', 'PROVIDER', {
          changes: { workSummary: summary.trim() || undefined },
        });
      }),

    providerCancelJob: (jobId, providerId, note) =>
      call(() => {
        assertProvider(jobId, providerId);
        return transitionJob(jobId, 'CANCELLED', 'PROVIDER', {
          metadata: { reason: 'provider_cancelled' },
          changes: {
            cancellation: {
              by: 'PROVIDER',
              reason: 'provider_cancelled',
              ...(note.trim() && { note: note.trim() }),
            },
          },
        });
      }),

    getJob: jobId => call(() => jobs.get(jobId), 300),
    getJobEvents: jobId => call(() => events.get(jobId) ?? [], 300),
    getJobSnapshot: jobId => jobs.get(jobId),
    getJobsSnapshot: () => jobList,
    getQuoteSnapshot: quoteId => quotes.get(quoteId),
    subscribe,
  };

  // ---- Payments ----

  const updatePayment = (paymentId: string, changes: Partial<Payment>) => {
    const next: Payment = {
      ...payments.get(paymentId)!,
      ...changes,
      updatedAt: now(),
    };
    putPayment(next);
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

  const settlePayment = (paymentId: string) => {
    const payment = payments.get(paymentId)!;
    if (jobs.get(payment.jobId)?.status !== 'PAYMENT_PENDING') {
      return;
    }
    const paid = updatePayment(paymentId, {
      status: 'SUCCESS',
      receiptNumber: makeReceiptNumber(),
    });
    transitionJob(payment.jobId, 'PAID', 'SYSTEM', {
      metadata: { paymentId, receiptNumber: paid.receiptNumber! },
      changes: {
        payment: {
          paymentId,
          amount: paid.amount,
          receiptNumber: paid.receiptNumber!,
          paidAt: paid.updatedAt,
        },
      },
    });
    setTimeout(() => {
      if (jobs.get(payment.jobId)?.status === 'PAID') {
        transitionJob(payment.jobId, 'COMPLETED', 'SYSTEM', {
          changes: { completedAt: now() },
        });
      }
    }, PAID_TO_COMPLETED_MS);
  };

  const paymentService: PaymentService = {
    initiatePayment: async (jobId, phoneInput) => {
      const phone = normaliseMpesaPhone(phoneInput);
      if (!phone) {
        throw new PaymentError(
          'Enter a valid M-Pesa number, e.g. 0712 345 678.',
        );
      }
      await delay(STK_SEND_MS);

      const job = jobs.get(jobId);
      if (job?.status !== 'PAYMENT_PENDING' || !job.amountDue) {
        throw new PaymentError('This job is not waiting for payment.');
      }
      const inFlight = paymentList.some(
        p =>
          p.jobId === jobId &&
          (p.status === 'PENDING' || p.status === 'PROCESSING'),
      );
      if (inFlight) {
        throw new PaymentError(
          'A payment for this job is already in progress.',
        );
      }

      const at = now();
      const payment: Payment = {
        id: makeId('pay'),
        jobId,
        method: 'MPESA',
        phone,
        amount: job.amountDue,
        status: 'PENDING',
        createdAt: at,
        updatedAt: at,
      };
      putPayment(payment);
      notify();

      // Like M-Pesa, give up if the customer never answers the prompt.
      setTimeout(() => {
        if (payments.get(payment.id)?.status === 'PENDING') {
          failPayment(payment.id, 'timeout');
        }
      }, STK_TIMEOUT_MS);
      return payment;
    },
    getPaymentSnapshot: paymentId => payments.get(paymentId),
    getPaymentsSnapshot: () => paymentList,
    subscribe,
  };

  const phone: SimulatedPhone = {
    respondToPaymentPrompt(paymentId, response) {
      if (payments.get(paymentId)?.status !== 'PENDING') {
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
    subscribe,
  };

  if (botProviderIds.length > 0) {
    startProviderBots(jobRepository, botProviderIds);
  }

  return {
    jobs: jobRepository,
    payments: paymentService,
    providers: providerRepository,
    phone,
  };
}
