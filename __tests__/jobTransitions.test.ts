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

describe('job transitions', () => {
  it('walks a repair from booking to completed', () => {
    const done = walk(job, [
      ['SEARCHING', 'SYSTEM'],
      ['OFFERED', 'SYSTEM'],
      ['ACCEPTED', 'PROVIDER'],
      ['EN_ROUTE', 'PROVIDER'],
      ['ARRIVED', 'PROVIDER'],
      ['DIAGNOSING', 'PROVIDER'],
      ['QUOTE_SENT', 'PROVIDER'],
      ['IN_PROGRESS', 'CUSTOMER'],
      ['AWAITING_CONFIRMATION', 'PROVIDER'],
      ['PAYMENT_PENDING', 'CUSTOMER'],
      ['COMPLETED', 'SYSTEM'],
    ]);
    expect(done.status).toBe('COMPLETED');
    expect(isTerminalStatus(done.status)).toBe(true);
  });

  it('walks a fixed-price service straight from arrival to work', () => {
    const done = walk({ ...job, pricingMode: 'FIXED' }, [
      ['SEARCHING', 'SYSTEM'],
      ['OFFERED', 'SYSTEM'],
      ['ACCEPTED', 'PROVIDER'],
      ['EN_ROUTE', 'PROVIDER'],
      ['ARRIVED', 'PROVIDER'],
      ['IN_PROGRESS', 'PROVIDER'],
      ['AWAITING_CONFIRMATION', 'PROVIDER'],
      ['PAYMENT_PENDING', 'CUSTOMER'],
      ['COMPLETED', 'SYSTEM'],
    ]);
    expect(done.status).toBe('COMPLETED');
  });

  it('guards the arrival fork by pricing mode', () => {
    expect(
      canTransition(at('ARRIVED', 'QUOTED'), 'DIAGNOSING', 'PROVIDER'),
    ).toBe(true);
    expect(
      canTransition(at('ARRIVED', 'QUOTED'), 'IN_PROGRESS', 'PROVIDER'),
    ).toBe(false);
    expect(
      canTransition(at('ARRIVED', 'FIXED'), 'IN_PROGRESS', 'PROVIDER'),
    ).toBe(true);
    expect(
      canTransition(at('ARRIVED', 'FIXED'), 'DIAGNOSING', 'PROVIDER'),
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
  });

  it('does not change the job it was given', () => {
    applyTransition(job, 'SEARCHING', 'SYSTEM', ctx(1));
    expect(job.status).toBe('CALL_OUT_PAYMENT_PENDING');
  });

  it('refuses to skip steps', () => {
    expect(() => applyTransition(job, 'COMPLETED', 'SYSTEM', ctx(1))).toThrow(
      JobTransitionError,
    );
  });

  it('lets only the payment system confirm money arrived', () => {
    expect(
      canTransition(at('CALL_OUT_PAYMENT_PENDING'), 'SEARCHING', 'CUSTOMER'),
    ).toBe(false);
    expect(canTransition(at('PAYMENT_PENDING'), 'COMPLETED', 'CUSTOMER')).toBe(
      false,
    );
    expect(canTransition(at('PAYMENT_PENDING'), 'COMPLETED', 'SYSTEM')).toBe(
      true,
    );
  });

  it('refuses moves by the wrong actor', () => {
    expect(
      canTransition(at('IN_PROGRESS'), 'AWAITING_CONFIRMATION', 'CUSTOMER'),
    ).toBe(false);
    expect(canTransition(at('QUOTE_SENT'), 'IN_PROGRESS', 'PROVIDER')).toBe(
      false,
    );
    expect(canTransition(at('SEARCHING'), 'CANCELLED', 'PROVIDER')).toBe(false);
  });

  it('sends a declined, expired or abandoned job back to searching', () => {
    expect(canTransition(at('OFFERED'), 'SEARCHING', 'PROVIDER')).toBe(true);
    expect(canTransition(at('OFFERED'), 'SEARCHING', 'SYSTEM')).toBe(true);
    // A provider withdrawing after accepting: rematch, don't cancel.
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

  it('lets only the provider withdraw a quote to revise it', () => {
    expect(canTransition(at('QUOTE_SENT'), 'DIAGNOSING', 'PROVIDER')).toBe(
      true,
    );
    expect(canTransition(at('QUOTE_SENT'), 'DIAGNOSING', 'CUSTOMER')).toBe(
      false,
    );
  });

  it('blocks approving a quote while it is being revised', () => {
    const quoted: Job = { ...job, status: 'QUOTE_SENT' };
    const revising = applyTransition(quoted, 'DIAGNOSING', 'PROVIDER', ctx(1));
    expect(() =>
      applyTransition(revising.job, 'IN_PROGRESS', 'CUSTOMER', ctx(2)),
    ).toThrow(JobTransitionError);
  });

  it('lets the customer confirm, or the system auto-confirm', () => {
    expect(
      allowedNextStatuses(at('AWAITING_CONFIRMATION'), 'CUSTOMER'),
    ).toEqual(['PAYMENT_PENDING', 'DISPUTED']);
    expect(allowedNextStatuses(at('AWAITING_CONFIRMATION'), 'SYSTEM')).toEqual([
      'PAYMENT_PENDING',
    ]);
    expect(
      allowedNextStatuses(at('AWAITING_CONFIRMATION'), 'PROVIDER'),
    ).toEqual([]);
  });

  it('lets only support move a disputed job on', () => {
    expect(isTerminalStatus('DISPUTED')).toBe(false);
    expect(allowedNextStatuses(at('DISPUTED'), 'SYSTEM')).toEqual([
      'IN_PROGRESS',
      'PAYMENT_PENDING',
      'CANCELLED',
    ]);
    expect(allowedNextStatuses(at('DISPUTED'), 'CUSTOMER')).toEqual([]);
    expect(allowedNextStatuses(at('DISPUTED'), 'PROVIDER')).toEqual([]);
  });

  it('allows nothing out of a finished job', () => {
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });
});
