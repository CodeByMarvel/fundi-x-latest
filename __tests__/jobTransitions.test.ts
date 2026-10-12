import { isProviderLate, LATE_GRACE_MS } from '../src/domain/jobs/rules';
import {
  allowedNextStatuses,
  applyTransition,
  canTransition,
  isTerminalStatus,
  JobTransitionError,
} from '../src/domain/jobs/transitions';
import {
  Job,
  JobActor,
  JobStatus,
  PricingMode,
} from '../src/domain/jobs/types';

const job: Job = {
  id: 'job-1',
  customerId: 'c1',
  pricingMode: 'QUOTED',
  requestType: 'repair',
  categoryId: 'brakes',
  vehicle: {
    id: 'v1',
    make: 'Toyota',
    model: 'Fielder',
    registration: 'KDA 123A',
  },
  answers: { 'brakes.symptoms': ['noise'] },
  description: '',
  drivability: 'safe',
  location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
  urgency: 'now',
  status: 'CALL_OUT_PAYMENT_PENDING',
  createdAt: '2026-10-07T08:00:00.000Z',
  updatedAt: '2026-10-07T08:00:00.000Z',
};

/** Just what the rules look at. */
const at = (status: JobStatus, pricingMode: PricingMode = 'QUOTED') => ({
  status,
  pricingMode,
});

const ctx = (n: number) => ({
  now: `2026-10-07T08:${String(n).padStart(2, '0')}:00.000Z`,
  eventId: `evt-${n}`,
});

function walk(start: Job, path: [JobStatus, JobActor][]) {
  let current = start;
  path.forEach(([to, actor], i) => {
    current = applyTransition(current, to, actor, ctx(i + 1)).job;
  });
  return current;
}

const TO_ARRIVAL: [JobStatus, JobActor][] = [
  ['SEARCHING', 'SYSTEM'],
  ['OFFERED', 'SYSTEM'],
  ['ACCEPTED', 'PROVIDER'],
  ['EN_ROUTE', 'PROVIDER'],
  ['ARRIVED', 'PROVIDER'],
];

describe('job transitions', () => {
  it('walks a repair: quote, pay into escrow, work, confirm', () => {
    const done = walk(job, [
      ...TO_ARRIVAL,
      ['DIAGNOSING', 'PROVIDER'],
      ['QUOTE_SENT', 'PROVIDER'],
      ['SERVICE_PAYMENT_PENDING', 'CUSTOMER'],
      ['IN_PROGRESS', 'SYSTEM'],
      ['AWAITING_CONFIRMATION', 'PROVIDER'],
      ['COMPLETED', 'CUSTOMER'],
    ]);
    expect(done.status).toBe('COMPLETED');
  });

  it('walks a fixed-price service: ready, pay into escrow, work, confirm', () => {
    const done = walk({ ...job, pricingMode: 'FIXED' }, [
      ...TO_ARRIVAL,
      ['SERVICE_PAYMENT_PENDING', 'PROVIDER'],
      ['IN_PROGRESS', 'SYSTEM'],
      ['AWAITING_CONFIRMATION', 'PROVIDER'],
      ['COMPLETED', 'CUSTOMER'],
    ]);
    expect(done.status).toBe('COMPLETED');
  });

  it('guards the arrival fork by pricing mode', () => {
    expect(
      canTransition(at('ARRIVED', 'QUOTED'), 'DIAGNOSING', 'PROVIDER'),
    ).toBe(true);
    expect(
      canTransition(
        at('ARRIVED', 'QUOTED'),
        'SERVICE_PAYMENT_PENDING',
        'PROVIDER',
      ),
    ).toBe(false);
    expect(
      canTransition(
        at('ARRIVED', 'FIXED'),
        'SERVICE_PAYMENT_PENDING',
        'PROVIDER',
      ),
    ).toBe(true);
    expect(
      canTransition(at('ARRIVED', 'FIXED'), 'DIAGNOSING', 'PROVIDER'),
    ).toBe(false);
  });

  it('starts work only when the payment system confirms the money', () => {
    expect(
      canTransition(at('SERVICE_PAYMENT_PENDING'), 'IN_PROGRESS', 'SYSTEM'),
    ).toBe(true);
    expect(
      canTransition(at('SERVICE_PAYMENT_PENDING'), 'IN_PROGRESS', 'PROVIDER'),
    ).toBe(false);
    expect(
      canTransition(at('CALL_OUT_PAYMENT_PENDING'), 'SEARCHING', 'CUSTOMER'),
    ).toBe(false);
  });

  it('records who made the change and when', () => {
    const { job: next, event } = applyTransition(job, 'SEARCHING', 'SYSTEM', {
      ...ctx(5),
      metadata: { paymentId: 'pay-1' },
    });
    expect(event).toEqual({
      id: 'evt-5',
      jobId: 'job-1',
      fromStatus: 'CALL_OUT_PAYMENT_PENDING',
      toStatus: 'SEARCHING',
      actor: 'SYSTEM',
      createdAt: '2026-10-07T08:05:00.000Z',
      metadata: { paymentId: 'pay-1' },
    });
    expect(next.updatedAt).toBe('2026-10-07T08:05:00.000Z');
    expect(job.status).toBe('CALL_OUT_PAYMENT_PENDING');
  });

  it('refuses to skip steps', () => {
    expect(() => applyTransition(job, 'COMPLETED', 'SYSTEM', ctx(1))).toThrow(
      JobTransitionError,
    );
  });

  it('lets the customer leave until work starts, and not after', () => {
    const canLeave = (status: JobStatus) =>
      canTransition(at(status), 'CANCELLED', 'CUSTOMER');
    for (const status of [
      'CALL_OUT_PAYMENT_PENDING',
      'SEARCHING',
      'OFFERED',
      'ACCEPTED',
      'EN_ROUTE',
      'ARRIVED',
      'DIAGNOSING',
      'QUOTE_SENT',
      'SERVICE_PAYMENT_PENDING',
    ] as const) {
      expect(canLeave(status)).toBe(true);
    }
    for (const status of [
      'IN_PROGRESS',
      'AWAITING_CONFIRMATION',
      'DISPUTED',
    ] as const) {
      expect(canLeave(status)).toBe(false);
    }
  });

  it('rematches when a provider withdraws, instead of cancelling', () => {
    expect(canTransition(at('ACCEPTED'), 'SEARCHING', 'PROVIDER')).toBe(true);
    expect(canTransition(at('EN_ROUTE'), 'SEARCHING', 'PROVIDER')).toBe(true);
    expect(canTransition(at('ACCEPTED'), 'CANCELLED', 'PROVIDER')).toBe(false);
  });

  it('lets the provider end the job only for a no-show at the location', () => {
    expect(allowedNextStatuses(at('ARRIVED'), 'PROVIDER')).toEqual([
      'DIAGNOSING',
      'CANCELLED',
    ]);
  });

  it('blocks approving a quote while it is being revised', () => {
    const quoted: Job = { ...job, status: 'QUOTE_SENT' };
    const revising = applyTransition(quoted, 'DIAGNOSING', 'PROVIDER', ctx(1));
    expect(() =>
      applyTransition(
        revising.job,
        'SERVICE_PAYMENT_PENDING',
        'CUSTOMER',
        ctx(2),
      ),
    ).toThrow(JobTransitionError);
  });

  it('completes on confirmation, by the customer or after 48 h', () => {
    expect(
      allowedNextStatuses(at('AWAITING_CONFIRMATION'), 'CUSTOMER'),
    ).toEqual(['COMPLETED', 'DISPUTED']);
    expect(allowedNextStatuses(at('AWAITING_CONFIRMATION'), 'SYSTEM')).toEqual([
      'COMPLETED',
    ]);
  });

  it('lets only support resolve a dispute, three ways', () => {
    expect(isTerminalStatus('DISPUTED')).toBe(false);
    expect(allowedNextStatuses(at('DISPUTED'), 'SYSTEM')).toEqual([
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(allowedNextStatuses(at('DISPUTED'), 'CUSTOMER')).toEqual([]);
  });

  it('allows nothing out of a finished job', () => {
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
  });
});

describe('late provider rule', () => {
  const expected = '2026-10-07T10:00:00.000Z';
  const enRoute = { status: 'EN_ROUTE', expectedArrivalAt: expected };

  it('counts as late only after arrival time + 20 minutes', () => {
    const due = Date.parse(expected);
    expect(isProviderLate(enRoute, due + LATE_GRACE_MS)).toBe(false);
    expect(isProviderLate(enRoute, due + LATE_GRACE_MS + 1)).toBe(true);
  });

  it('only applies while en route', () => {
    const later = Date.parse(expected) + LATE_GRACE_MS * 3;
    expect(isProviderLate({ ...enRoute, status: 'ARRIVED' }, later)).toBe(
      false,
    );
  });
});
