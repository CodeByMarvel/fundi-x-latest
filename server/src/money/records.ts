import type { ReleaseLine } from '../../../src/domain/billing/types';
import type { Cents } from '../../../src/domain/money';
import type { Tx } from '../db/client';
import { payments, refunds, releases } from '../db/schema';
import { newId } from '../ids';
import { account, post } from './ledger';

/**
 * The only places money records are created. Each writes the record (what
 * the apps and the portal show) and its ledger entry (the books) in the
 * caller's transaction, so the two can never disagree.
 */

type PaymentRow = typeof payments.$inferSelect;

/** M-Pesa confirmed the money: it's now held for the job. */
export async function recordPaymentReceived(tx: Tx, payment: PaymentRow, receipt: string, at: Date) {
  await post(
    tx,
    'PAYMENT_RECEIVED',
    `M-Pesa ${receipt} for ${payment.purpose.toLowerCase().replace('_', '-')}`,
    { jobId: payment.jobId, paymentId: payment.id },
    [
      { account: account.mpesa, amount: payment.amount },
      { account: account.escrow(payment.jobId), amount: -payment.amount },
    ],
    at,
  );
}

/**
 * Money out of escrow to the mechanic, Fundi-X's commission taken. The
 * mechanic is owed `net` until M-Pesa B2C sends it.
 */
export async function createRelease(
  tx: Tx,
  release: { jobId: string; providerId: string; lines: ReleaseLine[] },
  at: Date,
) {
  const gross = release.lines.reduce((s, l) => s + l.gross, 0);
  const commission = release.lines.reduce((s, l) => s + l.commission, 0);
  const id = newId('rel');
  await tx.insert(releases).values({
    id,
    jobId: release.jobId,
    providerId: release.providerId,
    lines: release.lines,
    gross,
    commission,
    net: gross - commission,
    createdAt: at,
  });
  await post(
    tx,
    'RELEASE',
    `Paid out to the mechanic: ${release.lines.map(l => l.purpose.toLowerCase()).join(' + ')}`,
    { jobId: release.jobId, releaseId: id },
    [
      { account: account.escrow(release.jobId), amount: gross },
      { account: account.provider(release.providerId), amount: -(gross - commission) },
      ...release.lines.map(l => ({ account: account.revenue(l.purpose), amount: -l.commission })),
    ],
    at,
  );
  return { id, gross, commission, net: gross - commission };
}

/** Money out of escrow back to the customer, owed until M-Pesa B2C sends it. */
export async function createRefund(
  tx: Tx,
  refund: { jobId: string; customerId: string; paymentId: string; amount: Cents; reason: string },
  at: Date,
) {
  const id = newId('ref');
  await tx.insert(refunds).values({
    id,
    jobId: refund.jobId,
    paymentId: refund.paymentId,
    amount: refund.amount,
    reason: refund.reason,
    status: 'PENDING',
    createdAt: at,
    updatedAt: at,
  });
  await post(
    tx,
    'REFUND',
    `Refund: ${refund.reason.replace(/_/g, ' ')}`,
    { jobId: refund.jobId, refundId: id, paymentId: refund.paymentId },
    [
      { account: account.escrow(refund.jobId), amount: refund.amount },
      { account: account.customer(refund.customerId), amount: -refund.amount },
    ],
    at,
  );
  return { id };
}
