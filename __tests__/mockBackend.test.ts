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
import { CALL_OUT_FEE, calculateEstimate } from '../src/domain/pricing/engine';
import { BOT_TIMINGS } from '../src/data/mock/providerBots';
import { balanceDue } from '../src/domain/billing/ledger';
import { MoneyPurpose, PaymentError } from '../src/domain/billing/types';
import {
  AUTO_CONFIRM_MS,
  CALL_OUT_PAYMENT_WINDOW_MS,
  LATE_GRACE_MS,
  NO_SHOW_WAIT_MS,
  SERVICE_PAYMENT_WINDOW_MS,
} from '../src/domain/jobs/rules';
import { JobTransitionError } from '../src/domain/jobs/transitions';
import { JobRequestDetails } from '../src/domain/jobs/types';
import { kes } from '../src/domain/money';
import { PriceChangedError } from '../src/domain/pricing/PricingService';
import {
  AdditionalQuotePendingError,
  line,
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
  line('BRAKE_PAD_FRONT', 2000, 2),
  line('LABOUR_BRAKE_PADS', 1500),
];
// Parts are paid out to the mechanic when paid; labour waits in escrow.
const PARTS = kes(4000);
const LABOUR = kes(1500);
const EXTRA: QuoteItemInput[] = [line('WIPER_BLADE', 600, 2)];

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
  quoteId?: string,
) {
  const payment = await run(
    b.billing.initiatePayment(jobId, '0712 345 678', { quoteId }),
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

/** …and p1 is on the way. */
async function enRouteJob(details: JobRequestDetails = REPAIR) {
  const ctx = await offeredJob(details);
  await run(ctx.b.jobs.acceptOffer(ctx.job.id, 'p1'));
  await run(ctx.b.jobs.startTrip(ctx.job.id, 'p1'));
  return ctx;
}

/** …and p1 is standing at the vehicle. */
async function arrivedJob(details: JobRequestDetails = REPAIR) {
  const ctx = await enRouteJob(details);
  await run(ctx.b.jobs.markArrived(ctx.job.id, 'p1'));
  return ctx;
}

/** A repair with p1's quote waiting for the customer. */
async function quotedJob() {
  const ctx = await arrivedJob();
  await run(ctx.b.jobs.startInspection(ctx.job.id, 'p1'));
  const quote = await run(ctx.b.jobs.sendQuote(ctx.job.id, 'p1', ITEMS));
  return { ...ctx, quote };
}

/** A repair with the quote approved and paid into escrow: work under way. */
async function repairInProgress() {
  const ctx = await quotedJob();
  await run(ctx.b.jobs.approveQuote(ctx.job.id, ctx.quote.id));
  await pay(ctx.b, ctx.job.id);
  return ctx;
}

/** A fixed-price service with its price paid into escrow: work under way. */
async function serviceInProgress() {
  const ctx = await arrivedJob(SERVICE);
  await run(ctx.b.jobs.readyToStart(ctx.job.id, 'p1'));
  await pay(ctx.b, ctx.job.id);
  return ctx;
}

/** Work finished, waiting for the customer to confirm. */
async function awaitingConfirmation() {
  const ctx = await repairInProgress();
  await run(ctx.b.jobs.markWorkComplete(ctx.job.id, 'p1', 'Done'));
  return ctx;
}

const status = (b: MockBackend, jobId: string) =>
  b.jobs.getJobSnapshot(jobId)?.status;

const due = (b: MockBackend, jobId: string, purpose: MoneyPurpose) =>
  balanceDue(
    b.billing.getChargesSnapshot(),
    b.billing.getPaymentsSnapshot(),
    jobId,
    purpose,
  );

const reliability = (b: MockBackend) =>
  b.providers.getReliabilityEventsSnapshot().map(e => e.type);

describe('buildJobDetails', () => {
  it('turns a finished draft into job details', () => {
    expect(REPAIR.description).toBe('Grinding when I stop');
    expect(REPAIR.vehicle).toEqual(vehicle);
    expect(REPAIR.vehicle).not.toBe(vehicle);
  });

  it('refuses an incomplete draft', () => {
    expect(() =>
      buildJobDetails({ ...repairDraft, location: undefined }, vehicle),
    ).toThrow();
  });
});

describe('pricing', () => {
  it('charges the configured flat call-out', () => {
    expect(CALL_OUT_FEE).toBe(CALL_OUT);
    expect(calculateEstimate(REPAIR)).toEqual({
      pricingMode: 'QUOTED',
      callOut: CALL_OUT,
    });
  });

  it('prices catalog maintenance as FIXED: labour, plus optional parts', () => {
    const estimate = calculateEstimate(SERVICE);
    expect(estimate.pricingMode).toBe('FIXED');
    // A Fielder is a small car: labour KSh 800, 4 L oil + filter.
    expect(estimate.fixedService?.vehicleClass).toBe('SMALL');
    expect(estimate.fixedService?.items.map(i => i.serviceCode)).toEqual([
      'LABOUR_OIL_CHANGE',
    ]);
    expect(estimate.fixedService?.parts.map(i => i.serviceCode)).toEqual([
      'ENGINE_OIL',
      'OIL_FILTER',
    ]);
    expect(estimate.fixedService?.total).toBe(kes(800 + 4 * 1000 + 900));
    const own = calculateEstimate({ ...SERVICE, partsOption: 'OWN' });
    expect(own.fixedService?.total).toBe(kes(800));
  });

  it('falls back to QUOTED for services the catalog cannot price', () => {
    expect(
      calculateEstimate({ ...SERVICE, categoryId: 'other_service' })
        .pricingMode,
    ).toBe('QUOTED');
  });
});

describe('booking and the call-out', () => {
  it('books a repair waiting for the call-out', async () => {
    const b = setup();
    const job = await book(b);
    expect(job.status).toBe('CALL_OUT_PAYMENT_PENDING');
    expect(due(b, job.id, 'CALL_OUT')).toBe(CALL_OUT);
  });

  it('books a maintenance job with its agreed Fundi-X price', async () => {
    const b = setup();
    const job = await book(b, SERVICE);
    const quote = b.jobs.getQuoteSnapshot(job.baseQuoteId!)!;
    expect(quote).toMatchObject({ issuedBy: 'FUNDI_X', status: 'APPROVED' });
    // Labour and parts are charged separately: parts are paid out sooner.
    expect(due(b, job.id, 'SERVICE') + due(b, job.id, 'PARTS')).toBe(
      quote.total,
    );
    expect(due(b, job.id, 'PARTS')).toBe(kes(4 * 1000 + 900));
  });

  it('refuses a booking at an outdated price', async () => {
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
  });

  it('closes a booking left unpaid for 30 minutes', async () => {
    const b = setup();
    const job = await book(b);
    await jest.advanceTimersByTimeAsync(CALL_OUT_PAYMENT_WINDOW_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'call_out_unpaid',
    );
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
    expect(b.billing.getRefundsSnapshot()).toEqual([
      expect.objectContaining({ paymentId: payment.id, amount: CALL_OUT }),
    ]);
  });
});

describe('matching', () => {
  it('offers the job to the nearest provider', async () => {
    const { b, job } = await offeredJob();
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p1');
  });

  it('skips providers who are offline or busy', async () => {
    const b = setup();
    await run(b.providers.setOnline('p1', false), 300);
    const job = await book(b);
    await pay(b, job.id);
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('records a declined offer and moves on', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.declineOffer(job.id, 'p1'));
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
    expect(reliability(b)).toEqual(['offer_declined']);
  });

  it('records an expired offer and moves on', async () => {
    const { b, job } = await offeredJob();
    await jest.advanceTimersByTimeAsync(OFFER_TIMEOUT_MS + MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
    expect(reliability(b)).toEqual(['offer_expired']);
  });

  it('refunds the call-out when nobody is available', async () => {
    const b = setup();
    for (const id of ['p1', 'p2', 'p3']) {
      await run(b.providers.setOnline(id, false), 300);
    }
    const job = await book(b);
    await pay(b, job.id);
    await jest.advanceTimersByTimeAsync(
      MATCHING_DELAY_MS * MAX_MATCHING_ROUNDS,
    );
    expect(b.jobs.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'no_provider_available',
    );
    expect(b.billing.getRefundsSnapshot()[0].status).toBe('PENDING');
    await jest.advanceTimersByTimeAsync(REFUND_PROCESSING_MS);
    expect(b.billing.getRefundsSnapshot()[0].status).toBe('SUCCESS');
  });
});

describe('customer cancelling', () => {
  it('refunds the call-out before the provider sets off', async () => {
    const { b, job } = await offeredJob();
    await run(b.jobs.acceptOffer(job.id, 'p1'));
    await run(b.jobs.cancelJob(job.id));
    expect(b.billing.getRefundsSnapshot()).toHaveLength(1);
  });

  it('pays the provider the call-out once they are on the way', async () => {
    const { b, job } = await enRouteJob();
    await run(b.jobs.cancelJob(job.id));
    expect(b.billing.getReleasesSnapshot()).toEqual([
      expect.objectContaining({ gross: CALL_OUT, net: kes(640) }),
    ]);
  });

  it('refunds the call-out when the provider is late, and records it', async () => {
    const { b, job } = await enRouteJob();
    const enRoute = b.jobs.getJobSnapshot(job.id)!;
    const lateAt =
      Date.parse(enRoute.expectedArrivalAt!) + LATE_GRACE_MS + 1000;
    await jest.advanceTimersByTimeAsync(lateAt - Date.now());

    const cancelled = await run(b.jobs.cancelJob(job.id));
    expect(cancelled.cancellation?.reason).toBe('provider_late');
    expect(b.billing.getRefundsSnapshot()[0].amount).toBe(CALL_OUT);
    expect(b.billing.getReleasesSnapshot()).toEqual([]);
    expect(reliability(b)).toContain('late');

    // Arriving afterwards changes nothing.
    await expectRejects(b.jobs.markArrived(job.id, 'p1'), JobTransitionError);
  });

  it('pays the provider the call-out when cancelled after arrival', async () => {
    const { b, job } = await arrivedJob();
    await run(b.jobs.cancelJob(job.id));
    expect(b.billing.getReleasesSnapshot()[0].gross).toBe(CALL_OUT);
  });

  it('refuses cancellation once work has started', async () => {
    const { b, job } = await repairInProgress();
    await expectRejects(b.jobs.cancelJob(job.id), JobTransitionError);
  });
});

describe('provider withdrawing', () => {
  it('rematches, keeps the call-out in escrow, and records it', async () => {
    const { b, job } = await enRouteJob();
    const withdrawn = await run(
      b.jobs.withdrawFromJob(job.id, 'p1', 'Flat tyre'),
    );
    expect(withdrawn.status).toBe('SEARCHING');
    expect(withdrawn.providerId).toBeUndefined();
    expect(b.billing.getRefundsSnapshot()).toEqual([]);
    expect(reliability(b)).toEqual(['withdrew_en_route']);

    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });
});

describe('customer no-show', () => {
  it('lets the provider end the job after 15 minutes and keep the call-out', async () => {
    const { b, job } = await arrivedJob();
    await expectRejects(
      b.jobs.reportCustomerNoShow(job.id, 'p1'),
      'Wait 15 minutes',
    );
    await jest.advanceTimersByTimeAsync(NO_SHOW_WAIT_MS);
    await run(b.jobs.reportCustomerNoShow(job.id, 'p1'));
    expect(b.billing.getReleasesSnapshot()[0].net).toBe(kes(640));
  });
});

describe('trip', () => {
  it('promises an arrival time and counts the ETA down', async () => {
    const { b, job } = await enRouteJob();
    const enRoute = b.jobs.getJobSnapshot(job.id)!;
    expect(enRoute.etaMinutes).toBe(6); // 1.2 km × 5 min/km
    expect(enRoute.expectedArrivalAt).toBeDefined();
    await jest.advanceTimersByTimeAsync(ETA_TICK_MS);
    const later = b.jobs.getJobSnapshot(job.id)!;
    expect(later.etaMinutes).toBe(5);
    // The promise doesn't move with the live ETA.
    expect(later.expectedArrivalAt).toBe(enRoute.expectedArrivalAt);
  });
});

describe('repair quotes', () => {
  it('refuses a line without a known service code', async () => {
    const ctx = await arrivedJob();
    await run(ctx.b.jobs.startInspection(ctx.job.id, 'p1'));
    await expectRejects(
      ctx.b.jobs.sendQuote(ctx.job.id, 'p1', [
        { ...ITEMS[0], serviceCode: 'MADE_UP' },
      ]),
      'from the list',
    );
  });

  it('asks for the money in escrow before work starts', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    expect(status(b, job.id)).toBe('SERVICE_PAYMENT_PENDING');
    expect(due(b, job.id, 'SERVICE')).toBe(LABOUR);
    expect(due(b, job.id, 'PARTS')).toBe(PARTS);

    await pay(b, job.id);
    expect(status(b, job.id)).toBe('IN_PROGRESS');
    expect(due(b, job.id, 'SERVICE')).toBe(0);
    expect(due(b, job.id, 'PARTS')).toBe(0);
    const [parts] = b.billing.getReleasesSnapshot();
    expect(parts.lines).toMatchObject([{ purpose: 'PARTS', gross: PARTS }]);
  });

  it('closes the job if the approved price is never paid', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    await jest.advanceTimersByTimeAsync(SERVICE_PAYMENT_WINDOW_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'service_unpaid',
    );
    expect(b.billing.getReleasesSnapshot()[0].gross).toBe(CALL_OUT);
  });

  it('lets the customer back out before paying (call-out kept)', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    await run(b.jobs.cancelJob(job.id));
    expect(b.billing.getReleasesSnapshot()[0].gross).toBe(CALL_OUT);
  });

  it('ends the job and releases the call-out when declined', async () => {
    const { b, job, quote } = await quotedJob();
    const ended = await run(b.jobs.rejectQuote(job.id, quote.id));
    expect(ended.cancellation?.reason).toBe('quote_declined');
    expect(b.billing.getReleasesSnapshot()[0].gross).toBe(CALL_OUT);
  });

  it('refuses approval of a quote the provider has revised', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.reviseQuote(job.id, 'p1'));
    const second = await run(b.jobs.sendQuote(job.id, 'p1', ITEMS));
    await expectRejects(b.jobs.approveQuote(job.id, quote.id), StaleQuoteError);
    await run(b.jobs.approveQuote(job.id, second.id));
  });
});

describe('fixed-price maintenance', () => {
  it('asks for the agreed price when the provider is ready, then starts', async () => {
    const { b, job } = await arrivedJob(SERVICE);
    await expectRejects(
      b.jobs.startInspection(job.id, 'p1'),
      JobTransitionError,
    );
    await run(b.jobs.readyToStart(job.id, 'p1'));
    expect(status(b, job.id)).toBe('SERVICE_PAYMENT_PENDING');

    const payment = await pay(b, job.id);
    expect(payment.amount).toBe(calculateEstimate(SERVICE).fixedService!.total);
    expect(status(b, job.id)).toBe('IN_PROGRESS');
  });
});

describe('additional quotes', () => {
  it('needs a reason', async () => {
    const { b, job } = await serviceInProgress();
    await expectRejects(
      b.jobs.raiseAdditionalQuote(job.id, 'p1', EXTRA, ' '),
      'Say why',
    );
  });

  it('is approved by paying for it, without changing the base quote', async () => {
    const { b, job } = await serviceInProgress();
    const base = b.jobs.getQuoteSnapshot(job.baseQuoteId!)!;
    const quote = await run(
      b.jobs.raiseAdditionalQuote(job.id, 'p1', EXTRA, 'Blades split'),
    );
    await expectRejects(
      b.jobs.approveQuote(job.id, quote.id),
      'approved by paying',
    );

    await pay(b, job.id, 'insufficient_funds', quote.id);
    expect(b.jobs.getQuoteSnapshot(quote.id)?.status).toBe('PENDING');

    await pay(b, job.id, 'pay', quote.id);
    expect(b.jobs.getQuoteSnapshot(quote.id)?.status).toBe('APPROVED');
    expect(b.jobs.getQuoteSnapshot(base.id)).toEqual(base);
    expect(status(b, job.id)).toBe('IN_PROGRESS');
  });

  it('blocks finishing until the customer answers', async () => {
    const { b, job } = await serviceInProgress();
    const quote = await run(
      b.jobs.raiseAdditionalQuote(job.id, 'p1', EXTRA, 'Blades split'),
    );
    await expectRejects(
      b.jobs.markWorkComplete(job.id, 'p1', ''),
      AdditionalQuotePendingError,
    );
    await run(b.jobs.rejectQuote(job.id, quote.id));
    await run(b.jobs.markWorkComplete(job.id, 'p1', ''));
    expect(status(b, job.id)).toBe('AWAITING_CONFIRMATION');
  });
});

describe('completion', () => {
  it('releases everything in escrow when the customer confirms', async () => {
    const { b, job } = await awaitingConfirmation();
    await run(b.jobs.confirmCompletion(job.id));
    expect(status(b, job.id)).toBe('COMPLETED');

    // The parts went when paid; the rest goes now.
    const [, release] = b.billing.getReleasesSnapshot();
    expect(release.lines.map(l => l.purpose)).toEqual(['CALL_OUT', 'SERVICE']);
    expect(release.gross).toBe(CALL_OUT + LABOUR);
    expect(release.commission).toBe(kes(160) + kes(300));
    expect(release.net).toBe(release.gross - release.commission);
  });

  it('completes automatically after 48 hours of silence', async () => {
    const { b, job } = await awaitingConfirmation();
    await jest.advanceTimersByTimeAsync(AUTO_CONFIRM_MS);
    expect(status(b, job.id)).toBe('COMPLETED');
    expect(b.billing.getReleasesSnapshot()).toHaveLength(2); // parts, then the rest
  });
});

describe('disputes', () => {
  async function disputed() {
    const ctx = await awaitingConfirmation();
    await run(ctx.b.jobs.disputeCompletion(ctx.job.id, 'Still grinding'));
    return ctx;
  }

  it('holds the money while support reviews', async () => {
    const { b, job } = await disputed();
    expect(status(b, job.id)).toBe('DISPUTED');
    // Only the parts, paid out before the work was done.
    expect(
      b.billing.getReleasesSnapshot().flatMap(r => r.lines.map(l => l.purpose)),
    ).toEqual(['PARTS']);
    expect(b.billing.getRefundsSnapshot()).toEqual([]);
  });

  it('sends the job back for rework', async () => {
    const { b, job } = await disputed();
    b.support.resolveDispute(job.id, { outcome: 'REWORK', note: 'Fix it' });
    expect(status(b, job.id)).toBe('IN_PROGRESS');
    expect(reliability(b)).toContain('dispute_rework');
  });

  it('completes and releases when support upholds the provider', async () => {
    const { b, job } = await disputed();
    b.support.resolveDispute(job.id, {
      outcome: 'UPHOLD_PROVIDER',
      note: 'Work was fine',
    });
    expect(status(b, job.id)).toBe('COMPLETED');
    expect(b.billing.getReleasesSnapshot()[1].gross).toBe(CALL_OUT + LABOUR);
  });

  it('refuses a split that does not divide exactly what is in escrow', async () => {
    const { b, job } = await disputed();
    expect(() =>
      b.support.resolveDispute(job.id, {
        outcome: 'SPLIT',
        customerRefund: kes(1000),
        providerPayout: kes(1000),
        note: '',
      }),
    ).toThrow('exactly what is in escrow');
    expect(status(b, job.id)).toBe('DISPUTED');
  });

  it('divides escrow as support decided', async () => {
    const { b, job } = await disputed();
    b.support.resolveDispute(job.id, {
      outcome: 'SPLIT',
      customerRefund: kes(1000),
      providerPayout: CALL_OUT + LABOUR - kes(1000),
      note: 'Partly fixed',
    });
    expect(b.jobs.getJobSnapshot(job.id)?.cancellation?.reason).toBe(
      'dispute_resolved',
    );
    expect(b.billing.getRefundsSnapshot().map(r => r.amount)).toEqual([
      kes(1000),
    ]);
    expect(b.billing.getReleasesSnapshot()[1].gross).toBe(
      CALL_OUT + LABOUR - kes(1000),
    );
    expect(reliability(b)).toContain('dispute_split');
  });

  it('is resolved by simulated support when enabled', async () => {
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
    await pay(b, job.id);
    await run(b.jobs.markWorkComplete(job.id, 'p1', ''));
    await run(b.jobs.disputeCompletion(job.id, 'Still grinding'));
    await jest.advanceTimersByTimeAsync(DISPUTE_REVIEW_MS);
    expect(b.jobs.getJobSnapshot(job.id)?.dispute?.resolution?.outcome).toBe(
      'REWORK',
    );
  });
});

describe('payments', () => {
  it('refuses an invalid phone number straight away', async () => {
    const { b, job } = await searchingJob();
    await expect(b.billing.initiatePayment(job.id, '12345')).rejects.toThrow(
      PaymentError,
    );
  });

  it('refuses a payment when nothing is due', async () => {
    const { b, job } = await searchingJob();
    await expectRejects(
      b.billing.initiatePayment(job.id, '0712345678'),
      'not waiting for payment',
      STK_SEND_MS,
    );
  });

  it('refuses a second payment while one is in progress', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    await run(b.billing.initiatePayment(job.id, '0712345678'), STK_SEND_MS);
    await expectRejects(
      b.billing.initiatePayment(job.id, '0712345678'),
      'already in progress',
      STK_SEND_MS,
    );
  });

  it('fails when the prompt is ignored, and can be retried', async () => {
    const { b, job, quote } = await quotedJob();
    await run(b.jobs.approveQuote(job.id, quote.id));
    const payment = await run(
      b.billing.initiatePayment(job.id, '0712345678'),
      STK_SEND_MS,
    );
    await jest.advanceTimersByTimeAsync(STK_TIMEOUT_MS);
    expect(b.billing.getPaymentSnapshot(payment.id)?.failureReason).toBe(
      'timeout',
    );
    await pay(b, job.id);
    expect(status(b, job.id)).toBe('IN_PROGRESS');
  });
});

describe('ratings', () => {
  it('saves the rating once, and updates the provider average', async () => {
    const { b, job } = await awaitingConfirmation();
    await run(b.jobs.confirmCompletion(job.id));
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
  it('run a fixed-price service, pausing for the customer to pay', async () => {
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
        NETWORK_MS * 4,
    );
    expect(status(b, job.id)).toBe('SERVICE_PAYMENT_PENDING');
    expect(b.jobs.getJobSnapshot(job.id)?.providerId).toBe('p2');

    await pay(b, job.id);
    await jest.advanceTimersByTimeAsync(BOT_TIMINGS.finishWork + NETWORK_MS);
    expect(status(b, job.id)).toBe('AWAITING_CONFIRMATION');
  });
});
