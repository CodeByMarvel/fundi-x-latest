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
const service = payment('pay-2', 'SERVICE', kes(6500));

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

const amounts = (moves: { amount: number }[]) => moves.map(m => m.amount);

describe('ledger', () => {
  it('works out the balance from charges and successful payments', () => {
    const charges = [
      charge('CALL_OUT', kes(800)),
      charge('SERVICE', kes(6500)),
    ];
    const payments = [
      callOut,
      payment('pay-x', 'SERVICE', kes(6500), 'FAILED'),
    ];
    expect(balanceDue(charges, payments, 'job-1', 'CALL_OUT')).toBe(0);
    // A failed payment doesn't count.
    expect(balanceDue(charges, payments, 'job-1', 'SERVICE')).toBe(kes(6500));
  });

  it('takes commission in whole cents', () => {
    expect(commissionOn(kes(800), 'CALL_OUT')).toBe(kes(160));
    expect(commissionOn(333, 'SERVICE')).toBe(67);
  });
});

describe('escrow settlement', () => {
  it('releases everything when the job completes', () => {
    const job = { id: 'job-1', status: 'COMPLETED', providerId: 'p1' } as Job;
    const { refund, release } = settlementFor(job, [callOut, service]);
    expect(refund).toEqual([]);
    expect(amounts(release)).toEqual([kes(800), kes(6500)]);
  });

  it.each([
    [
      'no provider found',
      cancelled('no_provider_available', 'SEARCHING', undefined),
    ],
    [
      'the customer cancels while searching',
      cancelled('customer_cancelled', 'SEARCHING', undefined),
    ],
    [
      'the customer cancels after acceptance',
      cancelled('customer_cancelled', 'ACCEPTED'),
    ],
    ['the provider is late', cancelled('provider_late', 'EN_ROUTE')],
  ])('refunds the call-out when %s', (_, job) => {
    expect(amounts(settlementFor(job, [callOut]).refund)).toEqual([kes(800)]);
  });

  it.each([
    [
      'the customer cancels on time while en route',
      cancelled('customer_cancelled', 'EN_ROUTE'),
    ],
    [
      'the customer cancels after arrival',
      cancelled('customer_cancelled', 'ARRIVED'),
    ],
    [
      'the customer cancels during diagnosis',
      cancelled('customer_cancelled', 'DIAGNOSING'),
    ],
    [
      'the customer backs out before paying',
      cancelled('customer_cancelled', 'SERVICE_PAYMENT_PENDING'),
    ],
    [
      'the service is never paid',
      cancelled('service_unpaid', 'SERVICE_PAYMENT_PENDING'),
    ],
    ['the repair quote is declined', cancelled('quote_declined', 'QUOTE_SENT')],
    [
      'the customer is not at the location',
      cancelled('customer_no_show', 'ARRIVED'),
    ],
  ])('releases the call-out to the provider when %s', (_, job) => {
    expect(amounts(settlementFor(job, [callOut]).release)).toEqual([kes(800)]);
  });

  it('divides escrow as support decided, refunding service money first', () => {
    const job = {
      ...cancelled('dispute_resolved', 'DISPUTED'),
      dispute: {
        reason: 'Still grinding',
        resolution: {
          outcome: 'SPLIT',
          customerRefund: kes(3000),
          providerPayout: kes(4300),
          note: '',
          decidedBy: 'agent',
          at: '',
        },
      },
    } as Job;
    const { refund, release } = settlementFor(job, [callOut, service]);
    expect(refund).toEqual([{ payment: service, amount: kes(3000) }]);
    expect(release).toEqual([
      { payment: service, amount: kes(3500) },
      { payment: callOut, amount: kes(800) },
    ]);
  });

  it('ignores payments that never succeeded', () => {
    const failed = payment('pay-9', 'CALL_OUT', kes(800), 'FAILED');
    expect(
      settlementFor(cancelled('no_provider_available', 'SEARCHING'), [failed])
        .refund,
    ).toEqual([]);
  });
});
