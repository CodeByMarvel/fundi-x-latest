import { Job, JobStatus } from '../jobs/types';
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

/** The parts share of a payment (fixed-price jobs only). */
export const partsShare = (p: Payment): Cents => p.partsAmount ?? 0;

/** How much of a payment went to one purpose. */
export function paidFor(p: Payment, purpose: MoneyPurpose): Cents {
  if (purpose === 'PARTS') {
    return partsShare(p);
  }
  return p.purpose === purpose ? p.amount - partsShare(p) : 0;
}

export function totalPaid(
  payments: readonly Payment[],
  jobId: string,
  purpose?: MoneyPurpose,
): Cents {
  return sum(
    successfulPayments(payments, jobId).map(p =>
      purpose ? paidFor(p, purpose) : p.amount,
    ),
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

/** Part (or all) of one payment, going somewhere. */
export type MoneyMove = { payment: Payment; amount: Cents };

/** What happens to the money in escrow when a job ends. */
export type Settlement = {
  /** Back to the customer. */
  refund: MoneyMove[];
  /** To the provider, before commission. */
  release: MoneyMove[];
};

/** Statuses where the provider had set off or was on site. */
const PROVIDER_COMMITTED: JobStatus[] = [
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'SERVICE_PAYMENT_PENDING',
];

/**
 * What a payment leaves in escrow: all of it, minus any parts money, which
 * was released to the mechanic when it arrived.
 */
export const heldInEscrow = (p: Payment): Cents => p.amount - partsShare(p);

/** Everything still held in escrow for this job. */
export function escrowTotal(
  payments: readonly Payment[],
  jobId: string,
): Cents {
  return sum(successfulPayments(payments, jobId).map(heldInEscrow));
}

/**
 * The escrow rules from docs/job-flow.md §8, as one pure function. Called
 * once, when a job reaches COMPLETED or CANCELLED. Only money actually in
 * escrow moves; unpaid charges on a closed job are simply void.
 */
export function settlementFor(
  job: Job,
  payments: readonly Payment[],
): Settlement {
  // Parts money already left escrow; only what's still held moves now.
  const paid = successfulPayments(payments, job.id).filter(
    p => heldInEscrow(p) > 0,
  );
  const whole = (p: Payment): MoneyMove => ({
    payment: p,
    amount: heldInEscrow(p),
  });
  const refundAll: Settlement = { refund: paid.map(whole), release: [] };
  const releaseAll: Settlement = { refund: [], release: paid.map(whole) };

  if (job.status === 'COMPLETED') {
    return releaseAll;
  }
  if (job.status !== 'CANCELLED' || !job.cancellation) {
    return { refund: [], release: [] };
  }
  // Nobody to pay: always refund.
  if (!job.providerId) {
    return refundAll;
  }

  switch (job.cancellation.reason) {
    case 'call_out_unpaid':
    case 'no_provider_available':
    case 'provider_late':
      return refundAll;
    case 'customer_cancelled':
      // Once the provider has set off, the call-out paid for their trip.
      return PROVIDER_COMMITTED.includes(job.cancellation.fromStatus)
        ? releaseAll
        : refundAll;
    case 'quote_declined':
    case 'service_unpaid':
    case 'customer_no_show':
      // The provider attended: the call-out covered transport and inspection.
      return releaseAll;
    case 'dispute_resolved':
      return splitByResolution(job, paid);
  }
}

/**
 * Divides escrow as support decided: the customer's refund comes out of
 * the service money first, then the call-out; the rest is released.
 */
function splitByResolution(job: Job, paid: Payment[]): Settlement {
  const resolution = job.dispute?.resolution;
  if (resolution?.outcome !== 'SPLIT') {
    return { refund: [], release: [] };
  }
  let toRefund = resolution.customerRefund;
  const ordered = [
    ...paid.filter(p => p.purpose === 'SERVICE'),
    ...paid.filter(p => p.purpose === 'CALL_OUT'),
  ];
  const settlement: Settlement = { refund: [], release: [] };
  for (const payment of ordered) {
    const held = heldInEscrow(payment);
    const refund = Math.min(toRefund, held);
    toRefund -= refund;
    if (refund > 0) {
      settlement.refund.push({ payment, amount: refund });
    }
    if (held - refund > 0) {
      settlement.release.push({ payment, amount: held - refund });
    }
  }
  return settlement;
}
