import {
  allowedNextStatuses,
  applyTransition,
  canTransition,
  isTerminalStatus,
  JobTransitionError,
} from '../src/domain/jobs/transitions';
import { Job, JobActor, JobStatus } from '../src/domain/jobs/types';

const job: Job = {
  id: 'job-1',
  customerId: 'c1',
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
  status: 'SEARCHING',
  createdAt: '2026-10-07T08:00:00.000Z',
  updatedAt: '2026-10-07T08:00:00.000Z',
};

const at = (n: number) => ({
  now: `2026-10-07T08:${String(n).padStart(2, '0')}:00.000Z`,
  eventId: `evt-${n}`,
});

describe('job transitions', () => {
  it('walks the happy path from searching to completed', () => {
    const path: [JobStatus, JobActor][] = [
      ['OFFERED', 'SYSTEM'],
      ['ACCEPTED', 'PROVIDER'],
      ['EN_ROUTE', 'PROVIDER'],
      ['ARRIVED', 'PROVIDER'],
      ['DIAGNOSING', 'PROVIDER'],
      ['QUOTE_SENT', 'PROVIDER'],
      ['IN_PROGRESS', 'CUSTOMER'],
      ['AWAITING_CONFIRMATION', 'PROVIDER'],
      ['PAYMENT_PENDING', 'CUSTOMER'],
      ['PAID', 'SYSTEM'],
      ['COMPLETED', 'SYSTEM'],
    ];

    let current = job;
    path.forEach(([to, actor], i) => {
      current = applyTransition(current, to, actor, at(i + 1)).job;
    });

    expect(current.status).toBe('COMPLETED');
    expect(isTerminalStatus(current.status)).toBe(true);
  });

  it('records who made the change and when', () => {
    const { job: next, event } = applyTransition(job, 'OFFERED', 'SYSTEM', {
      ...at(5),
      metadata: { providerId: 'p1' },
    });

    expect(event).toEqual({
      id: 'evt-5',
      jobId: 'job-1',
      fromStatus: 'SEARCHING',
      toStatus: 'OFFERED',
      actor: 'SYSTEM',
      createdAt: '2026-10-07T08:05:00.000Z',
      metadata: { providerId: 'p1' },
    });
    expect(next.updatedAt).toBe('2026-10-07T08:05:00.000Z');
  });

  it('does not change the job it was given', () => {
    applyTransition(job, 'OFFERED', 'SYSTEM', at(1));
    expect(job.status).toBe('SEARCHING');
  });

  it('refuses to skip steps', () => {
    expect(() => applyTransition(job, 'COMPLETED', 'SYSTEM', at(1))).toThrow(
      JobTransitionError,
    );
  });

  it('refuses moves by the wrong actor', () => {
    expect(
      canTransition('IN_PROGRESS', 'AWAITING_CONFIRMATION', 'CUSTOMER'),
    ).toBe(false);
    expect(canTransition('QUOTE_SENT', 'IN_PROGRESS', 'PROVIDER')).toBe(false);
    // Nobody but the payment system can mark a job paid.
    expect(canTransition('PAYMENT_PENDING', 'PAID', 'CUSTOMER')).toBe(false);
  });

  it('does not let a provider cancel a job that is still searching', () => {
    expect(canTransition('SEARCHING', 'CANCELLED', 'PROVIDER')).toBe(false);
  });

  it('lets only the provider withdraw a quote to revise it', () => {
    expect(canTransition('QUOTE_SENT', 'DIAGNOSING', 'PROVIDER')).toBe(true);
    expect(canTransition('QUOTE_SENT', 'DIAGNOSING', 'CUSTOMER')).toBe(false);
  });

  it('blocks approving a quote while it is being revised', () => {
    const quoted: Job = { ...job, status: 'QUOTE_SENT' };
    const revising = applyTransition(quoted, 'DIAGNOSING', 'PROVIDER', at(1));
    expect(() =>
      applyTransition(revising.job, 'IN_PROGRESS', 'CUSTOMER', at(2)),
    ).toThrow(JobTransitionError);
  });

  it('sends a declined or expired offer back to searching', () => {
    expect(canTransition('OFFERED', 'SEARCHING', 'PROVIDER')).toBe(true);
    expect(canTransition('OFFERED', 'SEARCHING', 'SYSTEM')).toBe(true);
  });

  it('lets a rejected quote go to payment for the inspection fee', () => {
    expect(canTransition('QUOTE_SENT', 'PAYMENT_PENDING', 'CUSTOMER')).toBe(
      true,
    );
  });

  it('lists what each actor can do next', () => {
    expect(allowedNextStatuses('AWAITING_CONFIRMATION', 'CUSTOMER')).toEqual([
      'PAYMENT_PENDING',
      'DISPUTED',
    ]);
    expect(allowedNextStatuses('AWAITING_CONFIRMATION', 'PROVIDER')).toEqual(
      [],
    );
    expect(allowedNextStatuses('ACCEPTED', 'PROVIDER')).toEqual([
      'EN_ROUTE',
      'CANCELLED',
    ]);
  });

  it('allows nothing out of a finished job', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'DISPUTED'] as const) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });
});
