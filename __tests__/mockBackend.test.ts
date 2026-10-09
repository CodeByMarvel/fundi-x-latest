import { buildJobDetails } from '../src/customer/request/engine';
import { EMPTY_DRAFT, RequestDraft } from '../src/customer/request/types';
import {
  createMockBackend,
  DISPUTE_REVIEW_MS,
  ETA_TICK_MS,
  MATCHING_DELAY_MS,
  MAX_MATCHING_ROUNDS,
  MockBackend,
  NETWORK_MS,
  OFFER_TIMEOUT_MS,
  PAYMENT_PROCESSING_MS,
  REFUND_PROCESSING_MS,
  STK_SEND_MS,
  STK_TIMEOUT_MS,
} from '../src/data/mock/mockBackend';
import { calculateEstimate } from '../src/data/mock/mockPricing';
import { BOT_TIMINGS } from '../src/data/mock/providerBots';
import { balanceDue } from '../src/domain/billing/ledger';
import { PaymentError } from '../src/domain/billing/types';
import {
  AUTO_CONFIRM_MS,
  CALL_OUT_PAYMENT_WINDOW_MS,
  NO_SHOW_WAIT_MS,
} from '../src/domain/jobs/rules';
import { JobTransitionError } from '../src/domain/jobs/transitions';
import { JobRequestDetails } from '../src/domain/jobs/types';
import { kes } from '../src/domain/money';
import { PriceChangedError } from '../src/domain/pricing/PricingService';
import {
  AdditionalQuotePendingError,
  StaleQuoteError,
} from '../src/domain/quotes/quotes';
import { QuoteItemInput } from '../src/domain/quotes/types';

const vehicle = {
  id: 'v1',
  make: 'Toyota',
  model: 'Fielder',
  registration: 'KDA 123A',
};

const repairDraft: RequestDraft = {
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

const REPAIR = buildJobDetails(repairDraft, vehicle);
const SERVICE: JobRequestDetails = {
  ...REPAIR,
  requestType: 'service',
  categoryId: 'oil_service',
  answers: {},
  description: '',
};

const CALL_OUT = kes(800);
const ITEMS: QuoteItemInput[] = [
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
const ITEMS_TOTAL = kes(4000 + 1500);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Runs a mock call, fast-forwarding through its simulated delay. */
async function run<T>(call: Promise<T>, ms = NETWORK_MS): Promise<T> {
  await jest.advanceTimersByTimeAsync(ms);
  return call;
}

/** Expects a mock call to fail, fast-forwarding through its delay. */
async function expectRejects(
  call: Promise<unknown>,
  error: unknown,
  ms = NETWORK_MS,
) {
  await Promise.all([
    expect(call).rejects.toThrow(error as Error),
    jest.advanceTimersByTimeAsync(ms),
  ]);
}

/** A backend without bots, so tests decide what every provider does. */
function setup() {
  return createMockBackend({ autoResolveDisputes: false });
}

/** Books a job at the current price, like the review screen does. */
function book(b: MockBackend, details: JobRequestDetails = REPAIR) {
  const estimate = calculateEstimate(details);
  return run(
    b.jobs.createJob({
      ...details,
      acceptedPrice: {
        callOut: estimate.callOut,
        fixedServiceTotal: estimate.fixedService?.total,
      },
    }),
  );
}

/** Starts an M-Pesa payment and answers the prompt on the "phone". */
async function pay(
  b: MockBackend,
  jobId: string,
  response: 'pay' | 'cancel' | 'insufficient_funds' = 'pay',
) {
  const payment = await run(
    b.billing.initiatePayment(jobId, '0712 345 678'),
    STK_SEND_MS,
  );
  b.phone.respondToPaymentPrompt(payment.id, response);
  await jest.advanceTimersByTimeAsync(PAYMENT_PROCESSING_MS);
  return payment;
}

/** Booked and call-out paid: matching has started. */
async function searchingJob(details: JobRequestDetails = REPAIR) {
  const b = setup();
  const job = await book(b, details);
  await pay(b, job.id);
  return { b, job };
}

/** …and offered to the nearest provider, p1. */
async function offeredJob(details: JobRequestDetails = REPAIR) {
  const ctx = await searchingJob(details);
  await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
  return ctx;
}

/** …and p1 is standing at the vehicle. */
async function arrivedJob(details: JobRequestDetails = REPAIR) {
  const ctx = await offeredJob(details);
  const { b, job } = ctx;
  await run(b.jobs.acceptOffer(job.id, 'p1'));
  await run(b.jobs.startTrip(job.id, 'p1'));
  await run(b.jobs.markArrived(job.id, 'p1'));
  return ctx;
}

/** A repair with p1's quote waiting for the customer. */
async function quotedJob() {
  const ctx = await arrivedJob();
  await run(ctx.b.jobs.startInspection(ctx.job.id, 'p1'));
  const quote = await run(ctx.b.jobs.sendQuote(ctx.job.id, 'p1', ITEMS));
  return { ...ctx, quote };
}

/** A repair with the work done and confirmed: service payment due. */
async function jobAwaitingPayment() {
  const ctx = await quotedJob();
  const { b, job, quote } = ctx;
  await run(b.jobs.approveQuote(job.id, quote.id));
  await run(b.jobs.markWorkComplete(job.id, 'p1', 'Done'));
  await run(b.jobs.confirmCompletion(job.id));
  return ctx;
}

const status = (b: MockBackend, jobId: string) =>
  b.jobs.getJobSnapshot(jobId)?.status;

describe('buildJobDetails', () => {
  it('turns a finished draft into job details', () => {
    expect(REPAIR.description).toBe('Grinding when I stop');
    expect(REPAIR.vehicle).toEqual(vehicle);
    // A copy, so later edits to the vehicle don't change the job.
    expect(REPAIR.vehicle).not.toBe(vehicle);
  });

  it('refuses an incomplete draft', () => {
    expect(() =>
      buildJobDetails({ ...repairDraft, location: undefined }, vehicle),
    ).toThrow();
    expect(() => buildJobDetails(repairDraft, undefined)).toThrow();
  });
});

describe('pricing', () => {
  it('charges a call-out of base + distance', () => {
    const estimate = calculateEstimate(REPAIR);
    expect(estimate.callOut).toBe(CALL_OUT);
    expect(estimate.pricingMode).toBe('QUOTED');
    expect(estimate.fixedService).toBeUndefined();
  });

  it('prices catalog maintenance as FIXED', () => {
    const estimate = calculateEstimate(SERVICE);
    expect(estimate.pricingMode).toBe('FIXED');
    expect(estimate.fixedService?.total).toBe(kes(3800 + 900 + 1000));
  });

  it('charges more for parts on premium makes', () => {
    const premium = calculateEstimate({
      ...SERVICE,
      vehicle: { ...vehicle, make: 'Mercedes-Benz' },
    });
    expect(premium.fixedService!.total).toBeGreaterThan(
      calculateEstimate(SERVICE).fixedService!.total,
    );
  });

  it('falls back to QUOTED for services the catalog cannot price', () => {
    expect(
      calculateEstimate({ ...SERVICE, categoryId: 'other_service' })
        .pricingMode,
    ).toBe('QUOTED');
  });
});

describe('booking and the call-out', () => {
  it('books a repair waiting for the call-out payment', async () => {
    const b = setup();
    const job = await book(b);
    expect(job.status).toBe('CALL_OUT_PAYMENT_PENDING');
    expect(job.pricingMode).toBe('QUOTED');
    expect(
      balanceDue(b.billing.getChargesSnapshot(), [], job.id, 'CALL_OUT'),
    ).toBe(CALL_OUT);
  });

  it('books a maintenance job with an accepted Fundi-X quote', async () => {
    const b = setup();
    const job = await book(b, SERVICE);
    const quote = b.jobs.getQuoteSnapshot(job.baseQuoteId!)!;
    expect(job.pricingMode).toBe('FIXED');
    expect(quote).toMatchObject({
      kind: 'BASE',
      issuedBy: 'FUNDI_X',
      status: 'APPROVED',
    });
    expect(quote.respondedAt).toBeDefined();
    expect(
      balanceDue(b.billing.getChargesSnapshot(), [], job.id, 'SERVICE'),
    ).toBe(quote.total);
  });

  it('refuses a booking at a price that is no longer current', async () => {
    const b = setup();
    await expectRejects(
      b.jobs.createJob({ ...REPAIR, acceptedPrice: { callOut: kes(1) } }),
      PriceChangedError,
    );
  });

  it("doesn't look for a fundi until the call-out is paid", async () => {
    const b = setup();
    const job = await book(b);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS * 3);
    expect(status(b, job.id)).toBe('CALL_OUT_PAYMENT_PENDING');

    await pay(b, job.id);
    expect(status(b, job.id)).toBe('SEARCHING');
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(status(b, job.id)).toBe('OFFERED');
  });

  it('stays bookable after a failed call-out payment', async () => {
    const b = setup();
    const job = await book(b);
    await pay(b, job.id, 'insufficient_funds');
    expect(status(b, job.id)).toBe('CALL_OUT_PAYMENT_PENDING');
    await pay(b, job.id);
    expect(status(b, job.id)).toBe('SEARCHING');
  });

  it('closes a booking left unpaid for 30 minutes', async () => {
    const b = setup();
    const job = await book(b);
    await jest.advanceTimersByTimeAsync(CALL_OUT_PAYMENT_WINDOW_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'call_out_unpaid',
    );
    expect(b.billing.getRefundsSnapshot()).toEqual([]);
  });

  it("doesn't close a booking while its payment prompt is open", async () => {
    const b = setup();
    const job = await book(b);
    await jest.advanceTimersByTimeAsync(CALL_OUT_PAYMENT_WINDOW_MS - 2000);
    await run(b.billing.initiatePayment(job.id, '0712345678'), STK_SEND_MS);
    await jest.advanceTimersByTimeAsync(1000);
    expect(status(b, job.id)).toBe('CALL_OUT_PAYMENT_PENDING');
  });

  it('refunds a call-out paid after the booking was cancelled', async () => {
    const b = setup();
    const job = await book(b);
    const payment = await run(
      b.billing.initiatePayment(job.id, '0712345678'),
      STK_SEND_MS,
    );
    await run(b.jobs.cancelJob(job.id));
    b.phone.respondToPaymentPrompt(payment.id, 'pay');
    await jest.advanceTimersByTimeAsync(PAYMENT_PROCESSING_MS);

    expect(status(b, job.id)).toBe('CANCELLED');
    expect(b.billing.getRefundsSnapshot()).toEqual([
      expect.objectContaining({ paymentId: payment.id, amount: CALL_OUT }),
    ]);
  });
});

describe('matching', () => {
  it('offers the job to the nearest provider, with an expiry', async () => {
    const { b, job } = await offeredJob();
    const offered = b.jobs.getJobSnapshot(job.id)!;
    expect(offered.offeredProviderId).toBe('p1');
    expect(offered.offerExpiresAt).toBeDefined();
  });

  it('skips providers who are offline', async () => {
    const b = setup();
    await run(b.providers.setOnline('p1', false), 300);
    const job = await book(b);
    await pay(b, job.id);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('skips providers who already have a job', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    const second = await book(b);
    await pay(b, second.id);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(second.id)?.offeredProviderId).toBe('p2');
  });

  it("refuses an accept from a provider who wasn't offered the job", async () => {
    const { b, job } = await offeredJob();
    await expectRejects(b.jobs.acceptOffer(job.id, 'p2'), 'not offered to p2');
  });

  it('offers a declined job to the next nearest provider', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.declineOffer(job.id, 'p1'));
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('moves on when an offer expires', async () => {
    const { b, job } = await offeredJob();
    await jest.advanceTimersByTimeAsync(OFFER_TIMEOUT_MS + MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('cancels and refunds when every provider declines', async () => {
    const { b, job } = await offeredJob();
    for (const providerId of ['p1', 'p2', 'p3']) {
      await run(b.jobs.declineOffer(job.id, providerId));
      await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    }
    expect(b.jobs.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'no_provider_available',
    );
    const [refund] = b.billing.getRefundsSnapshot();
    expect(refund).toMatchObject({ amount: CALL_OUT, status: 'PENDING' });

    await jest.advanceTimersByTimeAsync(REFUND_PROCESSING_MS);
    expect(b.billing.getRefundsSnapshot()[0].status).toBe('SUCCESS');
  });

  it('keeps trying while nobody is online, then gives up and refunds', async () => {
    const b = setup();
    for (const id of ['p1', 'p2', 'p3']) {
      await run(b.providers.setOnline(id, false), 300);
    }
    const job = await book(b);
    await pay(b, job.id);
    await jest.advanceTimersByTimeAsync(
      MATCHING_DELAY_MS * (MAX_MATCHING_ROUNDS - 1),
    );
    expect(status(b, job.id)).toBe('SEARCHING');
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(status(b, job.id)).toBe('CANCELLED');
    expect(b.billing.getRefundsSnapshot()).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('refunds the call-out when the customer cancels before the trip', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    await run(b.jobs.cancelJob(job.id));
    expect(b.billing.getRefundsSnapshot()).toHaveLength(1);
    expect(b.billing.getReleasesSnapshot()).toEqual([]);
  });

  it('pays the provider the call-out when cancelled during the trip', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    await run(b.jobs.startTrip(job.id, 'p1'));
    await run(b.jobs.cancelJob(job.id));

    expect(b.billing.getRefundsSnapshot()).toEqual([]);
    expect(b.billing.getReleasesSnapshot()).toEqual([
      expect.objectContaining({
        providerId: 'p1',
        gross: CALL_OUT,
        commission: kes(80),
        net: kes(720),
      }),
    ]);
  });

  it('refuses customer cancellation once work has started', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    await expectRejects(b.jobs.cancelJob(job.id), JobTransitionError);
  });
});

describe('provider withdrawing', () => {
  it('rematches the job and keeps the call-out in escrow', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    await run(b.jobs.startTrip(job.id, 'p1'));
    const withdrawn = await run(
      b.jobs.withdrawFromJob(job.id, 'p1', 'Flat tyre'),
    );

    expect(withdrawn.status).toBe('SEARCHING');
    expect(withdrawn.providerId).toBeUndefined();
    expect(withdrawn.reassignment).toMatchObject({
      providerId: 'p1',
      note: 'Flat tyre',
    });
    expect(b.billing.getRefundsSnapshot()).toEqual([]);

    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it("refuses to withdraw from someone else's job", async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    await expectRejects(
      b.jobs.withdrawFromJob(job.id, 'p2', ''),
      "doesn't belong to p2",
    );
  });
});

describe('customer no-show', () => {
  it('needs the provider to wait 15 minutes first', async () => {
    const { b, job } = await arrivedJob();
    await expectRejects(
      b.jobs.reportCustomerNoShow(job.id, 'p1'),
      'Wait 15 minutes',
    );
  });

  it('then ends the job and pays the provider the call-out', async () => {
    const { b, job } = await arrivedJob();
    await jest.advanceTimersByTimeAsync(NO_SHOW_WAIT_MS);
    const ended = await run(b.jobs.reportCustomerNoShow(job.id, 'p1'));
    expect(ended.cancellation?.reason).toBe('customer_no_show');
    expect(b.billing.getReleasesSnapshot()[0].net).toBe(kes(720));
  });
});

describe('trip', () => {
  it('counts the ETA down and records the arrival time', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    const enRoute = await run(b.jobs.startTrip(job.id, 'p1'));
    expect(enRoute.etaMinutes).toBe(6); // 1.2 km × 5 min/km
    await jest.advanceTimersByTimeAsync(ETA_TICK_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.etaMinutes).toBe(5);

    const arrived = await run(b.jobs.markArrived(job.id, 'p1'));
    expect(arrived.etaMinutes).toBeUndefined();
    expect(arrived.arrivedAt).toBeDefined();
  });
});

describe('repair quotes', () => {
  it('sends a quote with totals worked out', async () => {
    const { b, job, quote } = await quotedJob();
    expect(quote).toMatchObject({
      kind: 'BASE',
      issuedBy: 'PROVIDER',
      version: 1,
    });
    expect(quote.total).toBe(ITEMS_TOTAL);
    expect(b.jobs.getJobSnapshot(job.id)?.baseQuoteId).toBe(quote.id);
  });

  it('adds a service charge when the customer approves', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    expect(status(b, job.id)).toBe('IN_PROGRESS');
    expect(
      balanceDue(
        b.billing.getChargesSnapshot(),
        b.billing.getPaymentsSnapshot(),
        job.id,
        'SERVICE',
      ),
    ).toBe(ITEMS_TOTAL);
  });

  it('ends the job and pays the provider the call-out when declined', async () => {
    const { b, job, quote } = await quotedJob();
    const ended = await run(b.jobs.rejectQuote(job.id, quote.id));
    expect(ended.cancellation?.reason).toBe('quote_declined');
    expect(b.billing.getReleasesSnapshot()[0].gross).toBe(CALL_OUT);
  });

  it('refuses approval of a quote the provider has revised', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.reviseQuote(job.id, 'p1'));
    const second = await run(b.jobs.sendQuote(job.id, 'p1', ITEMS));
    expect(second.version).toBe(2);
    await expectRejects(b.jobs.approveQuote(job.id, quote.id), StaleQuoteError);
    await run(b.jobs.approveQuote(job.id, second.id));
  });
});

describe('fixed-price maintenance', () => {
  it('starts the service on arrival, without diagnosis', async () => {
    const { b, job } = await arrivedJob(SERVICE);
    await expectRejects(
      b.jobs.startInspection(job.id, 'p1'),
      JobTransitionError,
    );
    await run(b.jobs.startService(job.id, 'p1'));
    expect(status(b, job.id)).toBe('IN_PROGRESS');
  });
});

describe('additional quotes', () => {
  async function serviceInProgress() {
    const ctx = await arrivedJob(SERVICE);
    await run(ctx.b.jobs.startService(ctx.job.id, 'p1'));
    return ctx;
  }
  const extra: QuoteItemInput[] = [
    {
      kind: 'PART',
      description: 'Wiper blades',
      quantity: 2,
      unitPrice: kes(600),
    },
  ];

  it('needs a reason', async () => {
    const { b, job } = await serviceInProgress();
    await expectRejects(
      b.jobs.raiseAdditionalQuote(job.id, 'p1', extra, ' '),
      'Say why',
    );
  });

  it('blocks finishing until the customer answers', async () => {
    const { b, job } = await serviceInProgress();
    const quote = await run(
      b.jobs.raiseAdditionalQuote(job.id, 'p1', extra, 'Blades split'),
    );
    expect(quote).toMatchObject({ kind: 'ADDITIONAL', status: 'PENDING' });
    // The base work carries on: the job stays IN_PROGRESS.
    expect(status(b, job.id)).toBe('IN_PROGRESS');

    await expectRejects(
      b.jobs.markWorkComplete(job.id, 'p1', ''),
      AdditionalQuotePendingError,
    );
    await run(b.jobs.rejectQuote(job.id, quote.id));
    await run(b.jobs.markWorkComplete(job.id, 'p1', ''));
    expect(status(b, job.id)).toBe('AWAITING_CONFIRMATION');
  });

  it('adds to the bill when approved, without touching the base quote', async () => {
    const { b, job } = await serviceInProgress();
    const base = b.jobs.getQuoteSnapshot(job.baseQuoteId!)!;
    const quote = await run(
      b.jobs.raiseAdditionalQuote(job.id, 'p1', extra, 'Blades split'),
    );
    await run(b.jobs.approveQuote(job.id, quote.id));

    expect(b.jobs.getQuoteSnapshot(base.id)).toEqual(base);
    expect(
      balanceDue(
        b.billing.getChargesSnapshot(),
        b.billing.getPaymentsSnapshot(),
        job.id,
        'SERVICE',
      ),
    ).toBe(base.total + kes(1200));
  });
});

describe('completion', () => {
  it('asks for the service balance once the customer confirms', async () => {
    const { b, job } = await jobAwaitingPayment();
    expect(status(b, job.id)).toBe('PAYMENT_PENDING');
    expect(b.jobs.getJobSnapshot(job.id)?.workSummary).toBe('Done');
  });

  it('confirms automatically after 48 hours of silence', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    await run(b.jobs.markWorkComplete(job.id, 'p1', ''));
    await jest.advanceTimersByTimeAsync(AUTO_CONFIRM_MS);
    expect(status(b, job.id)).toBe('PAYMENT_PENDING');
  });

  it('sends a disputed job back to the provider after review', async () => {
    const b = createMockBackend();
    const job = await book(b);
    await pay(b, job.id);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    await run(b.jobs.startTrip(job.id, 'p1'));
    await run(b.jobs.markArrived(job.id, 'p1'));
    await run(b.jobs.startInspection(job.id, 'p1'));
    const quote = await run(b.jobs.sendQuote(job.id, 'p1', ITEMS));
    await run(b.jobs.approveQuote(job.id, quote.id));
    await run(b.jobs.markWorkComplete(job.id, 'p1', 'Done'));
    await run(b.jobs.disputeCompletion(job.id, 'Still grinding'));

    await jest.advanceTimersByTimeAsync(DISPUTE_REVIEW_MS);
    const reworked = b.jobs.getJobSnapshot(job.id)!;
    expect(reworked.status).toBe('IN_PROGRESS');
    expect(reworked.dispute?.resolution).toBeDefined();
  });
});

describe('service payment', () => {
  it('completes the job and releases everything to the provider', async () => {
    const { b, job } = await jobAwaitingPayment();
    const payment = await pay(b, job.id);
    expect(payment.purpose).toBe('SERVICE');
    expect(payment.amount).toBe(ITEMS_TOTAL);
    expect(status(b, job.id)).toBe('COMPLETED');

    const [release] = b.billing.getReleasesSnapshot();
    expect(release.lines.map(l => l.purpose)).toEqual(['CALL_OUT', 'SERVICE']);
    expect(release.gross).toBe(CALL_OUT + ITEMS_TOTAL);
    expect(release.net).toBe(release.gross - release.commission);
    expect(release.commission).toBe(kes(80) + kes(550));
  });

  it('refuses an invalid phone number straight away', async () => {
    const { b, job } = await jobAwaitingPayment();
    await expect(b.billing.initiatePayment(job.id, '12345')).rejects.toThrow(
      PaymentError,
    );
  });

  it('refuses a second payment while one is in progress', async () => {
    const { b, job } = await jobAwaitingPayment();
    await run(b.billing.initiatePayment(job.id, '0712345678'), STK_SEND_MS);
    await expectRejects(
      b.billing.initiatePayment(job.id, '0712345678'),
      'already in progress',
      STK_SEND_MS,
    );
  });

  it('fails when the prompt is ignored, and can be retried', async () => {
    const { b, job } = await jobAwaitingPayment();
    const payment = await run(
      b.billing.initiatePayment(job.id, '0712345678'),
      STK_SEND_MS,
    );
    await jest.advanceTimersByTimeAsync(STK_TIMEOUT_MS);
    expect(b.billing.getPaymentSnapshot(payment.id)?.failureReason).toBe(
      'timeout',
    );
    await pay(b, job.id);
    expect(status(b, job.id)).toBe('COMPLETED');
  });
});

describe('ratings', () => {
  it('saves the rating once, and updates the provider average', async () => {
    const { b, job } = await jobAwaitingPayment();
    await pay(b, job.id);
    const before = b.providers.getProviderSnapshot('p1')!;
    await run(b.jobs.submitRating(job.id, 5, 'Quick and tidy'));
    expect(b.providers.getProviderSnapshot('p1')!.ratingCount).toBe(
      before.ratingCount + 1,
    );
    await expectRejects(
      b.jobs.submitRating(job.id, 4, ''),
      'can no longer be rated',
    );
  });
});

describe('simulated providers', () => {
  it('run a fixed-price service on their own until it needs the customer', async () => {
    const b = createMockBackend({ botProviderIds: ['p2', 'p3'] });
    await run(b.providers.setOnline('p1', false), 300);
    const job = await book(b, SERVICE);
    await pay(b, job.id);

    await jest.advanceTimersByTimeAsync(
      MATCHING_DELAY_MS +
        BOT_TIMINGS.accept +
        BOT_TIMINGS.startTrip +
        BOT_TIMINGS.arrive +
        BOT_TIMINGS.inspect +
        BOT_TIMINGS.finishWork +
        NETWORK_MS * 5,
    );
    const done = b.jobs.getJobSnapshot(job.id)!;
    expect(done.providerId).toBe('p2');
    expect(done.status).toBe('AWAITING_CONFIRMATION');
  });
});
