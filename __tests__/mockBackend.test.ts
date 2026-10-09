import { buildCreateJobInput } from '../src/customer/request/engine';
import { EMPTY_DRAFT, RequestDraft } from '../src/customer/request/types';
import {
  createMockBackend,
  DISPUTE_REVIEW_MS,
  ETA_TICK_MS,
  MATCHING_DELAY_MS,
  MAX_MATCHING_ROUNDS,
  NETWORK_MS,
  OFFER_TIMEOUT_MS,
  PAID_TO_COMPLETED_MS,
  PAYMENT_PROCESSING_MS,
  STK_SEND_MS,
  STK_TIMEOUT_MS,
} from '../src/data/mock/mockBackend';
import { BOT_TIMINGS } from '../src/data/mock/providerBots';
import { JobTransitionError } from '../src/domain/jobs/transitions';
import { kes } from '../src/domain/money';
import { PaymentError } from '../src/domain/payments/types';
import { QuoteItemInput } from '../src/domain/quotes/types';

const vehicle = {
  id: 'v1',
  make: 'Toyota',
  model: 'Fielder',
  registration: 'KDA 123A',
};

const draft: RequestDraft = {
  ...EMPTY_DRAFT,
  requestType: 'repair',
  vehicleId: 'v1',
  categoryId: 'brakes',
  answers: { 'brakes.symptoms': ['noise'] },
  description: '  Grinding when I stop  ',
  drivability: 'caution',
  location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
  urgency: 'now',
};

const ITEMS: QuoteItemInput[] = [
  {
    kind: 'CALL_OUT',
    description: 'Call-out',
    quantity: 1,
    unitPrice: kes(1000),
  },
  {
    kind: 'PART',
    description: 'Brake pads',
    quantity: 2,
    unitPrice: kes(2000),
  },
  {
    kind: 'LABOUR',
    description: 'Fit pads',
    quantity: 1,
    unitPrice: kes(1500),
  },
];
const ITEMS_TOTAL = kes(1000 + 4000 + 1500);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/**
 * Runs a mock call, fast-forwarding through its simulated network delay but
 * not far enough to trigger background work like matching.
 */
async function run<T>(call: Promise<T>, ms = NETWORK_MS): Promise<T> {
  await jest.advanceTimersByTimeAsync(ms);
  return call;
}

/** Expects a mock call to fail, fast-forwarding through its delay. */
async function expectRejects(call: Promise<unknown>, error: unknown) {
  await Promise.all([
    expect(call).rejects.toThrow(error as Error),
    jest.advanceTimersByTimeAsync(NETWORK_MS),
  ]);
}

/** A backend without bots, so tests decide what every provider does. */
function setup() {
  const backend = createMockBackend({ autoResolveDisputes: false });
  return { ...backend, repo: backend.jobs };
}

async function createJob(repo = setup().repo) {
  return run(repo.createJob(buildCreateJobInput(draft, vehicle)));
}

/** Creates a job and lets matching offer it to the nearest provider, p1. */
async function offeredJob() {
  const backend = setup();
  const job = await createJob(backend.repo);
  await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
  return { ...backend, job };
}

/** Walks a job to QUOTE_SENT with ITEMS as the quote. */
async function quotedJob() {
  const backend = await offeredJob();
  const { repo, job } = backend;
  await run(repo.acceptOffer(job.id, 'p1'));
  await run(repo.startTrip(job.id, 'p1'));
  await run(repo.markArrived(job.id, 'p1'));
  await run(repo.startInspection(job.id, 'p1'));
  const quote = await run(repo.sendQuote(job.id, 'p1', ITEMS));
  return { ...backend, quote };
}

/** Walks a job to PAYMENT_PENDING for the full quote. */
async function jobAwaitingPayment() {
  const backend = await quotedJob();
  const { repo, job, quote } = backend;
  await run(repo.approveQuote(job.id, quote.id));
  await run(repo.markWorkComplete(job.id, 'p1', 'Done'));
  await run(repo.confirmCompletion(job.id));
  return backend;
}

describe('buildCreateJobInput', () => {
  it('turns a finished draft into job input', () => {
    const input = buildCreateJobInput(draft, vehicle);
    expect(input.description).toBe('Grinding when I stop');
    expect(input.vehicle).toEqual(vehicle);
    // A copy, so later edits to the vehicle don't change the job.
    expect(input.vehicle).not.toBe(vehicle);
  });

  it('refuses an incomplete draft', () => {
    expect(() =>
      buildCreateJobInput({ ...draft, location: undefined }, vehicle),
    ).toThrow();
    expect(() => buildCreateJobInput(draft, undefined)).toThrow();
  });
});

describe('creating jobs', () => {
  it('creates a searching job for the current customer', async () => {
    const job = await createJob();
    expect(job.status).toBe('SEARCHING');
    expect(job.customerId).toBe('customer-1');
    expect(job.vehicle.registration).toBe('KDA 123A');
  });

  it('takes time, like a network call', async () => {
    const { repo } = setup();
    let done = false;
    repo.createJob(buildCreateJobInput(draft, vehicle)).then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(NETWORK_MS - 100);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });

  it('records the creation as the first event', async () => {
    const { repo } = setup();
    const job = await createJob(repo);
    const events = await run(repo.getJobEvents(job.id));
    expect(events).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'SEARCHING' }),
    ]);
  });

  it('tells subscribers about changes until they unsubscribe', async () => {
    const { repo } = setup();
    const listener = jest.fn();
    const unsubscribe = repo.subscribe(listener);
    await createJob(repo);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await createJob(repo);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps snapshots stable until something changes', async () => {
    const { repo } = setup();
    const job = await createJob(repo);
    const list = repo.getJobsSnapshot();
    expect(repo.getJobsSnapshot()).toBe(list);
    expect(repo.getJobSnapshot(job.id)).toBe(repo.getJobSnapshot(job.id));
    await run(repo.cancelJob(job.id));
    expect(repo.getJobsSnapshot()).not.toBe(list);
  });
});

describe('matching and offers', () => {
  it('offers the job to the nearest provider', async () => {
    const { repo, job } = await offeredJob();
    const offered = repo.getJobSnapshot(job.id)!;
    expect(offered.status).toBe('OFFERED');
    expect(offered.offeredProviderId).toBe('p1');
    expect(offered.offerExpiresAt).toBeDefined();
  });

  it('skips providers who are offline', async () => {
    const { repo, providers } = setup();
    await run(providers.setOnline('p1', false), 300);
    const job = await createJob(repo);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('skips providers who already have a job', async () => {
    const { repo, job } = await offeredJob();
    await run(repo.acceptOffer(job.id, 'p1'));
    const second = await createJob(repo);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(second.id)?.offeredProviderId).toBe('p2');
  });

  it('lets the offered provider accept', async () => {
    const { repo, job } = await offeredJob();
    const accepted = await run(repo.acceptOffer(job.id, 'p1'));
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.providerId).toBe('p1');
    expect(accepted.offeredProviderId).toBeUndefined();
  });

  it('refuses an accept from a provider who was not offered the job', async () => {
    const { repo, job } = await offeredJob();
    await expectRejects(repo.acceptOffer(job.id, 'p2'), 'not offered to p2');
    expect(repo.getJobSnapshot(job.id)?.status).toBe('OFFERED');
  });

  it('offers a declined job to the next nearest provider', async () => {
    const { repo, job } = await offeredJob();
    await run(repo.declineOffer(job.id, 'p1'));
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('moves on when an offer expires', async () => {
    const { repo, job } = await offeredJob();
    await jest.advanceTimersByTimeAsync(OFFER_TIMEOUT_MS);
    expect(repo.getJobSnapshot(job.id)?.status).toBe('SEARCHING');
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');

    const events = await run(repo.getJobEvents(job.id), 300);
    expect(events).toContainEqual(
      expect.objectContaining({
        actor: 'SYSTEM',
        metadata: { providerId: 'p1', reason: 'offer_expired' },
      }),
    );
  });

  it('cancels the job when every provider has declined', async () => {
    const { repo, job } = await offeredJob();
    for (const providerId of ['p1', 'p2', 'p3']) {
      await run(repo.declineOffer(job.id, providerId));
      await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    }
    const cancelled = repo.getJobSnapshot(job.id)!;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancellation).toEqual({
      by: 'SYSTEM',
      reason: 'no_provider_available',
    });
  });

  it('keeps trying for a while when nobody is online, then gives up', async () => {
    const { repo, providers } = setup();
    for (const id of ['p1', 'p2', 'p3']) {
      await run(providers.setOnline(id, false), 300);
    }
    const job = await createJob(repo);

    await jest.advanceTimersByTimeAsync(
      MATCHING_DELAY_MS * (MAX_MATCHING_ROUNDS - 1),
    );
    expect(repo.getJobSnapshot(job.id)?.status).toBe('SEARCHING');

    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'no_provider_available',
    );
  });
});

describe('cancelling', () => {
  it('lets the customer cancel while searching, and stops matching', async () => {
    const { repo } = setup();
    const job = await createJob(repo);
    const cancelled = await run(repo.cancelJob(job.id));
    expect(cancelled.cancellation).toEqual({
      by: 'CUSTOMER',
      reason: 'customer_cancelled',
    });
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.status).toBe('CANCELLED');
  });

  it('refuses to cancel a job twice', async () => {
    const { repo } = setup();
    const job = await createJob(repo);
    await run(repo.cancelJob(job.id));
    await expectRejects(repo.cancelJob(job.id), JobTransitionError);
  });

  it('lets the provider cancel after accepting, with a reason', async () => {
    const { repo, job } = await offeredJob();
    await run(repo.acceptOffer(job.id, 'p1'));
    const cancelled = await run(
      repo.providerCancelJob(job.id, 'p1', 'Car broke down'),
    );
    expect(cancelled.cancellation).toEqual({
      by: 'PROVIDER',
      reason: 'provider_cancelled',
      note: 'Car broke down',
    });
  });

  it("refuses provider actions on someone else's job", async () => {
    const { repo, job } = await offeredJob();
    await run(repo.acceptOffer(job.id, 'p1'));
    await expectRejects(repo.startTrip(job.id, 'p2'), "doesn't belong to p2");
  });

  it('refuses customer cancellation once work has started', async () => {
    const { repo, job, quote } = await quotedJob();
    await run(repo.approveQuote(job.id, quote.id));
    await expectRejects(repo.cancelJob(job.id), JobTransitionError);
  });
});

describe('trip and inspection', () => {
  it('counts the ETA down while en route, and clears it on arrival', async () => {
    const { repo, job } = await offeredJob();
    await run(repo.acceptOffer(job.id, 'p1'));
    const enRoute = await run(repo.startTrip(job.id, 'p1'));
    expect(enRoute.etaMinutes).toBe(6); // 1.2 km × 5 min/km

    await jest.advanceTimersByTimeAsync(ETA_TICK_MS);
    expect(repo.getJobSnapshot(job.id)?.etaMinutes).toBe(5);

    const arrived = await run(repo.markArrived(job.id, 'p1'));
    expect(arrived.etaMinutes).toBeUndefined();
  });
});

describe('quotes', () => {
  it('sends a quote with totals worked out', async () => {
    const { repo, job, quote } = await quotedJob();
    expect(quote).toMatchObject({ version: 1, status: 'PENDING' });
    expect(quote.total).toBe(ITEMS_TOTAL);
    expect(quote.items[1].total).toBe(kes(4000));
    expect(repo.getJobSnapshot(job.id)?.quoteId).toBe(quote.id);
  });

  it('refuses an invalid quote', async () => {
    const { repo, job } = await offeredJob();
    await run(repo.acceptOffer(job.id, 'p1'));
    await run(repo.startTrip(job.id, 'p1'));
    await run(repo.markArrived(job.id, 'p1'));
    await run(repo.startInspection(job.id, 'p1'));
    await expectRejects(repo.sendQuote(job.id, 'p1', []), 'at least one item');
    await expectRejects(
      repo.sendQuote(job.id, 'p1', [{ ...ITEMS[0], unitPrice: 0 }]),
      'price above zero',
    );
  });

  it('starts work when the customer approves', async () => {
    const { repo, job, quote } = await quotedJob();
    const approved = await run(repo.approveQuote(job.id, quote.id));
    expect(approved.status).toBe('IN_PROGRESS');
    expect(repo.getQuoteSnapshot(quote.id)?.status).toBe('APPROVED');
  });

  it('charges only the call-out fee when the customer rejects', async () => {
    const { repo, job, quote } = await quotedJob();
    const rejected = await run(repo.rejectQuote(job.id, quote.id));
    expect(rejected.status).toBe('PAYMENT_PENDING');
    expect(rejected.amountDue).toBe(kes(1000));
    expect(rejected.chargeType).toBe('INSPECTION_ONLY');
    expect(repo.getQuoteSnapshot(quote.id)?.status).toBe('REJECTED');
  });

  it('closes the job when a quote with no fee is rejected', async () => {
    const { repo, job, quote } = await quotedJob();
    await run(repo.reviseQuote(job.id, 'p1'));
    const free = await run(repo.sendQuote(job.id, 'p1', ITEMS.slice(1)));
    const rejected = await run(repo.rejectQuote(job.id, free.id));
    expect(rejected.cancellation?.reason).toBe('quote_rejected');
    expect(quote.id).not.toBe(free.id);
  });

  it('refuses approval of a quote the provider has revised', async () => {
    const { repo, job, quote } = await quotedJob();
    await run(repo.reviseQuote(job.id, 'p1'));
    expect(repo.getQuoteSnapshot(quote.id)?.status).toBe('SUPERSEDED');

    const second = await run(repo.sendQuote(job.id, 'p1', ITEMS));
    expect(second.version).toBe(2);
    // The customer's screen still showed version 1.
    await expectRejects(
      repo.approveQuote(job.id, quote.id),
      'no longer current',
    );
    await run(repo.approveQuote(job.id, second.id));
  });
});

describe('completion and disputes', () => {
  it('asks for the full quote once the customer confirms the work', async () => {
    const { repo, job } = await jobAwaitingPayment();
    const confirmed = repo.getJobSnapshot(job.id)!;
    expect(confirmed.status).toBe('PAYMENT_PENDING');
    expect(confirmed.amountDue).toBe(ITEMS_TOTAL);
    expect(confirmed.chargeType).toBe('FULL');
    expect(confirmed.workSummary).toBe('Done');
  });

  it('sends a disputed job back to the provider after review', async () => {
    const backend = createMockBackend();
    const repo = backend.jobs;
    const job = await createJob(repo);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    await run(repo.acceptOffer(job.id, 'p1'));
    await run(repo.startTrip(job.id, 'p1'));
    await run(repo.markArrived(job.id, 'p1'));
    await run(repo.startInspection(job.id, 'p1'));
    const quote = await run(repo.sendQuote(job.id, 'p1', ITEMS));
    await run(repo.approveQuote(job.id, quote.id));
    await run(repo.markWorkComplete(job.id, 'p1', 'Done'));

    const disputed = await run(
      repo.disputeCompletion(job.id, 'Still grinding'),
    );
    expect(disputed.status).toBe('DISPUTED');

    await jest.advanceTimersByTimeAsync(DISPUTE_REVIEW_MS);
    const reworked = repo.getJobSnapshot(job.id)!;
    expect(reworked.status).toBe('IN_PROGRESS');
    expect(reworked.dispute?.reason).toBe('Still grinding');
    expect(reworked.dispute?.resolution).toBeDefined();
  });

  it('needs a reason to dispute', async () => {
    const { repo, job, quote } = await quotedJob();
    await run(repo.approveQuote(job.id, quote.id));
    await run(repo.markWorkComplete(job.id, 'p1', ''));
    await expectRejects(
      repo.disputeCompletion(job.id, '  '),
      'what went wrong',
    );
  });
});

describe('payments', () => {
  async function startPayment() {
    const backend = await jobAwaitingPayment();
    const payment = await run(
      backend.payments.initiatePayment(backend.job.id, '0712 345 678'),
      STK_SEND_MS,
    );
    return { ...backend, payment };
  }

  it('sends an STK prompt for the amount due', async () => {
    const { payment } = await startPayment();
    expect(payment).toMatchObject({
      status: 'PENDING',
      phone: '254712345678',
      amount: ITEMS_TOTAL,
    });
  });

  it('refuses an invalid phone number straight away', async () => {
    const { payments, job } = await jobAwaitingPayment();
    await expect(payments.initiatePayment(job.id, '12345')).rejects.toThrow(
      PaymentError,
    );
  });

  it('refuses a second payment while one is in progress', async () => {
    const { payments, job } = await startPayment();
    await Promise.all([
      expect(payments.initiatePayment(job.id, '0712345678')).rejects.toThrow(
        'already in progress',
      ),
      jest.advanceTimersByTimeAsync(STK_SEND_MS),
    ]);
  });

  it('completes the job when the customer pays', async () => {
    const { repo, payments, phone, job, payment } = await startPayment();

    phone.respondToPaymentPrompt(payment.id, 'pay');
    expect(payments.getPaymentSnapshot(payment.id)?.status).toBe('PROCESSING');

    await jest.advanceTimersByTimeAsync(PAYMENT_PROCESSING_MS);
    const paid = payments.getPaymentSnapshot(payment.id)!;
    expect(paid.status).toBe('SUCCESS');
    expect(paid.receiptNumber).toMatch(/^S[A-Z0-9]{9}$/);
    expect(repo.getJobSnapshot(job.id)?.status).toBe('PAID');
    expect(repo.getJobSnapshot(job.id)?.payment?.amount).toBe(ITEMS_TOTAL);

    await jest.advanceTimersByTimeAsync(PAID_TO_COMPLETED_MS);
    expect(repo.getJobSnapshot(job.id)?.status).toBe('COMPLETED');
  });

  it('leaves the job awaiting payment when the customer cancels the prompt', async () => {
    const { repo, payments, phone, job, payment } = await startPayment();
    phone.respondToPaymentPrompt(payment.id, 'cancel');
    expect(payments.getPaymentSnapshot(payment.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'cancelled_by_user',
    });
    expect(repo.getJobSnapshot(job.id)?.status).toBe('PAYMENT_PENDING');

    // And they can try again.
    const retry = await run(
      payments.initiatePayment(job.id, '0712345678'),
      STK_SEND_MS,
    );
    expect(retry.status).toBe('PENDING');
  });

  it('fails on insufficient funds', async () => {
    const { payments, phone, payment } = await startPayment();
    phone.respondToPaymentPrompt(payment.id, 'insufficient_funds');
    await jest.advanceTimersByTimeAsync(PAYMENT_PROCESSING_MS);
    expect(payments.getPaymentSnapshot(payment.id)?.failureReason).toBe(
      'insufficient_funds',
    );
  });

  it('times out when the prompt is ignored', async () => {
    const { payments, payment } = await startPayment();
    await jest.advanceTimersByTimeAsync(STK_TIMEOUT_MS);
    expect(payments.getPaymentSnapshot(payment.id)?.failureReason).toBe(
      'timeout',
    );
  });
});

describe('ratings', () => {
  async function completedJob() {
    const backend = await jobAwaitingPayment();
    const payment = await run(
      backend.payments.initiatePayment(backend.job.id, '0712345678'),
      STK_SEND_MS,
    );
    backend.phone.respondToPaymentPrompt(payment.id, 'pay');
    await jest.advanceTimersByTimeAsync(
      PAYMENT_PROCESSING_MS + PAID_TO_COMPLETED_MS,
    );
    return backend;
  }

  it('saves the rating and updates the provider average', async () => {
    const { repo, providers, job } = await completedJob();
    const before = providers.getProviderSnapshot('p1')!;

    const rated = await run(repo.submitRating(job.id, 5, 'Quick and tidy'));
    expect(rated.rating).toMatchObject({ stars: 5, comment: 'Quick and tidy' });

    const after = providers.getProviderSnapshot('p1')!;
    expect(after.ratingCount).toBe(before.ratingCount + 1);
    expect(after.rating).toBeGreaterThanOrEqual(before.rating);
  });

  it('refuses a second rating', async () => {
    const { repo, job } = await completedJob();
    await run(repo.submitRating(job.id, 4, ''));
    await expectRejects(
      repo.submitRating(job.id, 5, ''),
      'can no longer be rated',
    );
  });
});

describe('simulated providers', () => {
  it('run a whole job on their own up to the quote', async () => {
    const backend = createMockBackend({ botProviderIds: ['p2', 'p3'] });
    const repo = backend.jobs;
    await run(backend.providers.setOnline('p1', false), 300);
    const job = await createJob(repo);

    await jest.advanceTimersByTimeAsync(
      MATCHING_DELAY_MS +
        BOT_TIMINGS.accept +
        BOT_TIMINGS.startTrip +
        BOT_TIMINGS.arrive +
        BOT_TIMINGS.inspect +
        BOT_TIMINGS.quote +
        NETWORK_MS * 5,
    );

    const quoted = repo.getJobSnapshot(job.id)!;
    expect(quoted.status).toBe('QUOTE_SENT');
    expect(quoted.providerId).toBe('p2');
    expect(
      repo.getQuoteSnapshot(quoted.quoteId!)?.items.length,
    ).toBeGreaterThan(0);
  });
});
