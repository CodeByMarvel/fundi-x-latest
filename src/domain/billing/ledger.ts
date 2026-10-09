import { Job } from '../jobs/types';
import { Cents } from '../money';
import { Charge, MoneyPurpose, Payment, Refund } from './types';

const sum = (amounts: Cents[]) => amounts.reduce((a, b) => a + b, 0);

export function chargesFor(charges: readonly Charge[], jobId: string) {
  return charges.filter(c => c.jobId === jobId);
}

/** Payments that actually reached escrow. */
export function successfulPayments(
  payments: readonly Payment[],
  jobId: string,
) {
  return payments.filter(p => p.jobId === jobId && p.status === 'SUCCESS');
}

export function totalCharged(
  charges: readonly Charge[],
  jobId: string,
  purpose?: MoneyPurpose,
): Cents {
  return sum(
    chargesFor(charges, jobId)
      .filter(c => !purpose || c.purpose === purpose)
      .map(c => c.amount),
  );
}

export function totalPaid(
  payments: readonly Payment[],
  jobId: string,
  purpose?: MoneyPurpose,
): Cents {
  return sum(
    successfulPayments(payments, jobId)
      .filter(p => !purpose || p.purpose === purpose)
      .map(p => p.amount),
  );
}

export function totalRefunded(
  refunds: readonly Refund[],
  jobId: string,
): Cents {
  return sum(refunds.filter(r => r.jobId === jobId).map(r => r.amount));
}

/**
 * What the customer still owes for one purpose. Never stored: always worked
 * out from the charges and payments, so it can't drift out of step.
 */
export function balanceDue(
  charges: readonly Charge[],
  payments: readonly Payment[],
  jobId: string,
  purpose: MoneyPurpose,
): Cents {
  return (
    totalCharged(charges, jobId, purpose) - totalPaid(payments, jobId, purpose)
  );
}

/** What happens to the money in escrow when a job ends. */
export type Settlement = {
  /** Payments to send back to the customer. */
  refund: Payment[];
  /** Payments to pay out to the provider (minus commission). */
  release: Payment[];
  /** True when the rule isn't decided yet: money stays in escrow. */
  hold: boolean;
};

/**
 * The escrow rules from docs/job-flow.md §3.5, as one pure function. Called
 * once, when a job reaches COMPLETED or CANCELLED.
 */
export function settlementFor(
  job: Job,
  payments: readonly Payment[],
): Settlement {
  const paid = successfulPayments(payments, job.id);
  const refundAll: Settlement = { refund: paid, release: [], hold: false };
  const releaseAll: Settlement = { refund: [], release: paid, hold: false };

  if (job.status === 'COMPLETED') {
    return releaseAll;
  }
  if (job.status !== 'CANCELLED' || !job.cancellation) {
    return { refund: [], release: [], hold: false };
  }
  // Nobody to pay: always refund.
  if (!job.providerId) {
    return refundAll;
  }

  switch (job.cancellation.reason) {
    case 'call_out_unpaid':
    case 'no_provider_available':
      return refundAll;
    case 'customer_cancelled':
      // Once the provider has set off, the call-out paid for their trip.
      return job.cancellation.fromStatus === 'EN_ROUTE'
        ? releaseAll
        : refundAll;
    case 'quote_declined':
    case 'customer_no_show':
      // The provider attended: the call-out covered transport and inspection.
      return releaseAll;
    case 'dispute_closed':
      // OPEN in the spec: keep it in escrow until a person decides.
      return { refund: [], release: [], hold: true };
  }
}
