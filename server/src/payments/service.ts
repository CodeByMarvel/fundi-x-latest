import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { releaseLine } from '../../../src/domain/billing/commission';
import {
  normaliseMpesaPhone,
  type Payment,
  type PaymentFailureReason,
  type PaymentPurpose,
} from '../../../src/domain/billing/types';
import { balanceDue } from '../../../src/domain/billing/ledger';
import { STK_TIMEOUT_MS } from '../../../src/domain/jobs/rules';
import { partsTotal } from '../../../src/domain/quotes/quotes';
import type { QuoteItem } from '../../../src/domain/quotes/types';
import type { Caller } from '../auth';
import type { Database, Tx } from '../db/client';
import { charges, payments, quotes, refunds, releases, users } from '../db/schema';
import { ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import { getJob, moveJob } from '../jobs/service';
import { lockJob, toPayment, toQuote } from '../jobs/store';
import { callOutPaid } from '../matching/service';
import { createRefund, createRelease, recordPaymentReceived } from '../money/records';
import { type MpesaGateway, MpesaError, type StkOutcome, toShillings } from '../mpesa/gateway';
import { SIMULATED } from '../mpesa/simulator';
import { commissionRates } from '../settings';
import { scheduleTimer } from '../timers/schedule';

/**
 * Money coming in (docs/job-flow.md §9). Two halves:
 *
 * 1. startPayment: the customer taps "Pay". We decide what for and how
 *    much (never the app), record a PENDING payment, and ask M-Pesa to
 *    show the PIN prompt.
 * 2. paymentSucceeded / paymentFailed: M-Pesa tells us how it went. These
 *    are the only places money arriving moves a job on, whoever reports
 *    it: Daraja's callback (step 3) or, in development, the simulator.
 */

const IN_FLIGHT = ['PENDING', 'PROCESSING'] as const;

/** A refusal the app shows as "Please check: …". */
const paymentRefused = (message: string) => new ConflictError('payment_refused', message);

const toCharge = (r: typeof charges.$inferSelect) => ({
  id: r.id,
  jobId: r.jobId,
  purpose: r.purpose,
  amount: r.amount,
  description: r.description,
  ...(r.quoteId && { quoteId: r.quoteId }),
  createdAt: r.createdAt.toISOString(),
});

export const toRefund = (r: typeof refunds.$inferSelect) => ({
  id: r.id,
  jobId: r.jobId,
  paymentId: r.paymentId,
  amount: r.amount,
  reason: r.reason,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const toRelease = (r: typeof releases.$inferSelect) => ({
  id: r.id,
  jobId: r.jobId,
  providerId: r.providerId,
  lines: r.lines,
  gross: r.gross,
  commission: r.commission,
  net: r.net,
  createdAt: r.createdAt.toISOString(),
});

/**
 * An approved quote becomes what the customer owes: the parts as their own
 * charge (paid out to the mechanic as soon as they're paid, like a
 * fixed-price job's parts), the rest held in escrow until confirmation.
 */
export async function chargeForQuote(
  tx: Tx,
  quote: { id: string; jobId: string; items: QuoteItem[]; total: number },
  label: { work: string; parts: string },
  at: Date,
) {
  const parts = partsTotal(quote.items);
  const values = (purpose: 'SERVICE' | 'PARTS', amount: number, text: string) => ({
    id: newId('chg'),
    jobId: quote.jobId,
    purpose,
    amount,
    description: text,
    quoteId: quote.id,
    createdAt: at,
  });
  if (quote.total > parts) {
    await tx.insert(charges).values(values('SERVICE', quote.total - parts, label.work));
  }
  if (parts > 0) {
    await tx.insert(charges).values(values('PARTS', parts, label.parts));
  }
}

/**
 * Asks the customer's phone for the money the job is waiting for: the
 * call-out, the agreed price, or (with `quoteId`) extra work, which is
 * approved by paying for it.
 */
export function startPayment(
  db: Database,
  caller: Caller,
  jobId: string,
  phoneInput: string,
  quoteId?: string,
): Promise<Payment> {
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    if (caller.role !== 'CUSTOMER' || job.customerId !== caller.id) {
      throw new NotFoundError('Job');
    }
    const phone = normaliseMpesaPhone(phoneInput);
    if (!phone) {
      throw paymentRefused('Enter a valid M-Pesa number, e.g. 0712 345 678.');
    }
    const jobPayments = (
      await tx.select().from(payments).where(eq(payments.jobId, jobId))
    ).map(toPayment);
    const jobCharges = (
      await tx.select().from(charges).where(eq(charges.jobId, jobId))
    ).map(toCharge);

    let purpose: PaymentPurpose | undefined;
    let amount = 0;
    let partsAmount = 0;
    if (quoteId) {
      if (job.status !== 'IN_PROGRESS') {
        throw paymentRefused('Extra work can only be paid for while work is in progress.');
      }
      const [row] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.jobId, jobId)));
      if (!row || row.kind !== 'ADDITIONAL' || row.status !== 'PENDING') {
        throw paymentRefused('This extra-work quote is no longer waiting for payment.');
      }
      purpose = 'SERVICE';
      amount = row.total;
      partsAmount = partsTotal(row.items);
    } else if (job.status === 'CALL_OUT_PAYMENT_PENDING') {
      purpose = 'CALL_OUT';
      amount = balanceDue(jobCharges, jobPayments, jobId, purpose);
    } else if (job.status === 'SERVICE_PAYMENT_PENDING') {
      // One PIN prompt for the agreed work and, if the mechanic brings
      // them, the parts; the payment records how much is parts.
      purpose = 'SERVICE';
      partsAmount = balanceDue(jobCharges, jobPayments, jobId, 'PARTS');
      amount = balanceDue(jobCharges, jobPayments, jobId, purpose) + partsAmount;
    }
    if (!purpose) {
      throw paymentRefused('This job is not waiting for payment.');
    }
    if (amount <= 0) {
      throw paymentRefused('There is nothing to pay right now.');
    }
    // One PIN prompt at a time, so a double tap can't charge twice.
    if (jobPayments.some(p => (IN_FLIGHT as readonly string[]).includes(p.status))) {
      throw paymentRefused('A payment for this job is already in progress.');
    }

    const at = new Date();
    const [row] = await tx
      .insert(payments)
      .values({
        id: newId('pay'),
        jobId,
        purpose,
        quoteId: quoteId ?? null,
        method: 'MPESA',
        phone,
        amount,
        partsAmount,
        status: 'PENDING',
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    // A prompt nobody answers must not block the job forever.
    await scheduleTimer(tx, {
      jobId,
      kind: 'PAYMENT_TIMEOUT',
      dueAt: new Date(at.getTime() + STK_TIMEOUT_MS),
      at,
    });
    // The prompt itself is sent after this commits (sendPrompt): never
    // call M-Pesa while holding the job's lock.
    return toPayment(row);
  });
}

const PROMPT_TEXT: Record<PaymentPurpose, string> = { CALL_OUT: 'Call-out', SERVICE: 'Service' };

/**
 * Sends the PIN prompt for a payment just recorded by startPayment. If
 * M-Pesa refuses or can't be reached, the payment fails as `not_sent` and
 * the customer can try again; nothing was charged. The customer only sees
 * "couldn't send"; Daraja's reason goes to `onNotSent` for the log.
 */
export async function sendPrompt(
  db: Database,
  mpesa: MpesaGateway,
  payment: Payment,
  onNotSent: (err: MpesaError) => void = () => {},
): Promise<Payment> {
  try {
    const sent = await mpesa.stkPush({
      phone: payment.phone,
      shillings: toShillings(payment.amount),
      // Shown on the customer's statement: Fundi-X and the job.
      accountReference: `FX${payment.jobId.replace(/^job_/, '').slice(0, 8).toUpperCase()}`,
      description: payment.quoteId ? 'Extra work' : PROMPT_TEXT[payment.purpose],
    });
    const [row] = await db
      .update(payments)
      .set({ checkoutRequestId: sent.checkoutRequestId, merchantRequestId: sent.merchantRequestId, updatedAt: new Date() })
      .where(eq(payments.id, payment.id))
      .returning();
    return toPayment(row);
  } catch (err) {
    if (!(err instanceof MpesaError)) {
      throw err;
    }
    onNotSent(err);
    await db.transaction(tx => paymentFailed(tx, payment.id, 'not_sent', new Date()));
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    return toPayment(row);
  }
}

/**
 * Locks a payment M-Pesa may still report money for: one waiting for an
 * answer, or one we gave up on after a timeout. A late "paid" for the
 * latter is real money and must be recorded (and refunded if the job has
 * moved on). Returns undefined for anything else, e.g. already paid.
 */
async function lockOpenPayment(tx: Tx, paymentId: string, forSuccess = false) {
  const [row] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .for('update');
  if (!row) {
    return undefined;
  }
  const open = (IN_FLIGHT as readonly string[]).includes(row.status);
  const lateSuccess = forSuccess && row.status === 'FAILED' && row.failureReason === 'timeout';
  return open || lateSuccess ? row : undefined;
}

/**
 * M-Pesa confirmed the money: it's in escrow. Moves the job on in the same
 * transaction. Safe to call twice for the same payment (M-Pesa does resend
 * callbacks): the second call finds it already settled and does nothing.
 */
export async function paymentSucceeded(
  tx: Tx,
  paymentId: string,
  receiptNumber: string,
  at: Date,
) {
  const row = await lockOpenPayment(tx, paymentId, true);
  if (!row) {
    return;
  }
  await tx
    .update(payments)
    .set({ status: 'SUCCESS', failureReason: null, receiptNumber, updatedAt: at })
    .where(eq(payments.id, paymentId));
  await recordPaymentReceived(tx, row, receiptNumber, at);
  const job = await lockJob(tx, row.jobId);
  // They typed their M-Pesa PIN on this number: it's theirs
  // (docs/authentication.md, phone verification).
  await tx
    .update(users)
    .set({ phoneVerifiedAt: at, updatedAt: at })
    .where(and(eq(users.id, job.customerId), eq(users.phone, row.phone), isNull(users.phoneVerifiedAt)));
  const metadata = { paymentId, receiptNumber };

  if (row.purpose === 'CALL_OUT' && job.status === 'CALL_OUT_PAYMENT_PENDING') {
    await callOutPaid(tx, job, at);
    return;
  }
  // The parts money goes to the mechanic now, so they can buy the parts;
  // the rest stays in escrow until the customer confirms.
  const releaseParts = async () => {
    if (row.partsAmount > 0 && job.providerId) {
      const line = releaseLine(row.id, 'PARTS', row.partsAmount, await commissionRates(tx));
      await createRelease(tx, { jobId: job.id, providerId: job.providerId, lines: [line] }, at);
    }
  };
  if (row.purpose === 'SERVICE' && !row.quoteId && job.status === 'SERVICE_PAYMENT_PENDING') {
    await releaseParts();
    // The agreed price is in escrow: work can start.
    await moveJob(tx, job, 'IN_PROGRESS', 'SYSTEM', at, { metadata });
    return;
  }
  if (row.quoteId && job.status === 'IN_PROGRESS') {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, row.quoteId));
    if (quote?.status === 'PENDING') {
      // Approve-and-pay: the extra work is approved once it's paid for.
      await tx
        .update(quotes)
        .set({ status: 'APPROVED', respondedAt: at })
        .where(eq(quotes.id, quote.id));
      const reason = toQuote(quote).reason ?? 'extra work';
      await chargeForQuote(
        tx,
        quote,
        { work: `Additional: ${reason}`, parts: `Additional parts: ${reason}` },
        at,
      );
      await releaseParts();
      return;
    }
  }
  // The job moved on while the customer was paying (e.g. they cancelled
  // with the PIN prompt still open): give the money back.
  await createRefund(
    tx,
    { jobId: job.id, customerId: job.customerId, paymentId, amount: row.amount, reason: 'job_closed_before_payment' },
    at,
  );
}

/** The customer cancelled the prompt, had too little money, or never answered. */
export async function paymentFailed(
  tx: Tx,
  paymentId: string,
  reason: PaymentFailureReason,
  at: Date,
) {
  if (!(await lockOpenPayment(tx, paymentId))) {
    return;
  }
  await tx
    .update(payments)
    .set({ status: 'FAILED', failureReason: reason, updatedAt: at })
    .where(eq(payments.id, paymentId));
}

/**
 * Fails this job's prompts that have been open longer than M-Pesa keeps
 * them, so the customer can try again. Run by the PAYMENT_TIMEOUT timer.
 * Prompts sent through Daraja are left to the reconciler
 * (mpesa/reconcile.ts), which asks M-Pesa how they ended first.
 */
export async function expireStalePayments(tx: Tx, jobId: string, now: Date) {
  const open = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.jobId, jobId), inArray(payments.status, [...IN_FLIGHT])));
  for (const p of open) {
    const viaDaraja = !!p.checkoutRequestId && !p.checkoutRequestId.startsWith(SIMULATED);
    if (!viaDaraja && p.createdAt.getTime() + STK_TIMEOUT_MS <= now.getTime()) {
      await paymentFailed(tx, p.id, 'timeout', now);
    }
  }
}

/** Applies what M-Pesa says about a prompt (from its callback or a status query). */
export async function applyStkOutcome(db: Database, paymentId: string, outcome: StkOutcome, at = new Date()) {
  if (outcome.state === 'PENDING') {
    return;
  }
  await db.transaction(tx =>
    outcome.state === 'SUCCESS'
      ? paymentSucceeded(tx, paymentId, outcome.receipt ?? `UNCONFIRMED-${paymentId.slice(-8)}`, at)
      : paymentFailed(tx, paymentId, outcome.reason, at),
  );
}

/**
 * A job's money records. The customer sees all of it; the provider only
 * their payout (the customer's M-Pesa number and payments aren't theirs).
 */
export async function jobMoney(db: Database, caller: Caller, jobId: string) {
  await getJob(db, caller, jobId); // same visibility as the job itself
  const payoutsOnly = caller.role === 'PROVIDER';
  const rels = await db
    .select()
    .from(releases)
    .where(
      payoutsOnly
        ? and(eq(releases.jobId, jobId), eq(releases.providerId, caller.id))
        : eq(releases.jobId, jobId),
    )
    .orderBy(asc(releases.createdAt));
  if (payoutsOnly) {
    return { charges: [], payments: [], refunds: [], releases: rels.map(toRelease) };
  }
  const [chg, pay, ref] = await Promise.all([
    db.select().from(charges).where(eq(charges.jobId, jobId)).orderBy(asc(charges.createdAt)),
    db.select().from(payments).where(eq(payments.jobId, jobId)).orderBy(asc(payments.createdAt)),
    db.select().from(refunds).where(eq(refunds.jobId, jobId)).orderBy(asc(refunds.createdAt)),
  ]);
  return {
    charges: chg.map(toCharge),
    payments: pay.map(toPayment),
    refunds: ref.map(toRefund),
    releases: rels.map(toRelease),
  };
}
