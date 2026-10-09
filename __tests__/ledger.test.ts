import { commissionOn } from '../src/domain/billing/commission';
import { balanceDue, settlementFor } from '../src/domain/billing/ledger';
import { Charge, Payment } from '../src/domain/billing/types';
import { Job, JobStatus } from '../src/domain/jobs/types';
import { kes } from '../src/domain/money';

const payment = (
  id: string,
  purpose: Payment['purpose'],
  amount: number,
  status: Payment['status'] = 'SUCCESS',
): Payment => ({
  id,
  jobId: 'job-1',
  purpose,
  method: 'MPESA',
  phone: '254712345678',
  amount,
  status,
  createdAt: '',
  updatedAt: '',
});

const charge = (purpose: Charge['purpose'], amount: number): Charge => ({
  id: `chg-${purpose}-${amount}`,
  jobId: 'job-1',
  purpose,
  amount,
  description: '',
  createdAt: '',
});

const callOut = payment('pay-1', 'CALL_OUT', kes(800));
const service = payment('pay-2', 'SERVICE', kes(7000));

function cancelled(
  reason: NonNullable<Job['cancellation']>['reason'],
  fromStatus: JobStatus,
  providerId: string | undefined = 'p1',
) {
  return {
    id: 'job-1',
    status: 'CANCELLED',
    providerId,
    cancellation: { by: 'CUSTOMER', reason, fromStatus },
  } as Job;
}

describe('ledger', () => {
  it('works out the balance from charges and successful payments', () => {
    const charges = [
      charge('CALL_OUT', kes(800)),
      charge('SERVICE', kes(6500)),
      charge('SERVICE', kes(500)),
    ];
    const payments = [
      callOut,
      payment('pay-x', 'SERVICE', kes(7000), 'FAILED'),
    ];
    expect(balanceDue(charges, payments, 'job-1', 'CALL_OUT')).toBe(0);
    // A failed payment doesn't count.
    expect(balanceDue(charges, payments, 'job-1', 'SERVICE')).toBe(kes(7000));
  });

  it('takes commission in whole cents', () => {
    expect(commissionOn(kes(800), 'CALL_OUT')).toBe(kes(80));
    expect(commissionOn(333, 'SERVICE')).toBe(33);
  });
});

describe('escrow settlement', () => {
  it('releases everything when the job completes', () => {
    const job = { id: 'job-1', status: 'COMPLETED', providerId: 'p1' } as Job;
    expect(settlementFor(job, [callOut, service])).toEqual({
      refund: [],
      release: [callOut, service],
      hold: false,
    });
  });

  it.each([
    [
      'no provider found',
      cancelled('no_provider_available', 'SEARCHING', undefined),
    ],
    [
      'customer cancels while searching',
      cancelled('customer_cancelled', 'SEARCHING', undefined),
    ],
    [
      'customer cancels after acceptance',
      cancelled('customer_cancelled', 'ACCEPTED'),
    ],
  ])('refunds the call-out when %s', (_, job) => {
    expect(settlementFor(job, [callOut]).refund).toEqual([callOut]);
  });

  it.each([
    [
      'customer cancels while the provider is en route',
      cancelled('customer_cancelled', 'EN_ROUTE'),
    ],
    [
      'customer declines the repair quote',
      cancelled('quote_declined', 'QUOTE_SENT'),
    ],
    [
      'customer is not at the location',
      cancelled('customer_no_show', 'ARRIVED'),
    ],
  ])('releases the call-out to the provider when %s', (_, job) => {
    expect(settlementFor(job, [callOut]).release).toEqual([callOut]);
  });

  it('holds the money when support closes a dispute (undecided rule)', () => {
    expect(
      settlementFor(cancelled('dispute_closed', 'DISPUTED'), [callOut]),
    ).toEqual({ refund: [], release: [], hold: true });
  });

  it('ignores payments that never succeeded', () => {
    const failed = payment('pay-9', 'CALL_OUT', kes(800), 'FAILED');
    expect(
      settlementFor(cancelled('no_provider_available', 'SEARCHING'), [failed])
        .refund,
    ).toEqual([]);
  });
});
