import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/client';
import { payments } from '../db/schema';
import { reportIncident } from '../incidents';
import { applyStkOutcome } from '../payments/service';
import { callbackPaths } from './daraja';
import { stkFailureReason } from './gateway';

/** What M-Pesa Express posts when a prompt ends. */
type StkCallback = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
    };
  };
};

/** Safaricom stops retrying once it gets this. */
const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

/**
 * Where Safaricom tells us how a payment or transfer ended (docs/mpesa.md).
 * The addresses contain a secret only Safaricom is given, and every
 * callback is checked against our own record before anything moves, so a
 * forged or stray call can't credit money. We always answer "accepted":
 * a problem is ours to investigate (it becomes an incident), not a reason
 * for Safaricom to keep resending.
 */
export function registerMpesaCallbacks(
  app: FastifyInstance,
  db: Database,
  { secret, allowedIps }: { secret: string; allowedIps: string[] },
) {
  const paths = callbackPaths(secret);

  /** Optional second lock: only Safaricom's published addresses. */
  const fromSafaricom = (request: FastifyRequest) =>
    allowedIps.length === 0 || allowedIps.includes(request.ip);

  const incident = (request: FastifyRequest, title: string, detail: Record<string, unknown>, jobId?: string) =>
    reportIncident(
      db,
      { kind: 'mpesa', title, where: 'M-Pesa callback', detail, jobId: jobId ?? null, requestId: request.id },
      request.log,
    );

  app.post<{ Body: StkCallback }>(paths.stk, async request => {
    if (!fromSafaricom(request)) {
      await incident(request, 'Callback from an unknown address', { ip: request.ip });
      return ACCEPTED;
    }
    const cb = request.body?.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) {
      await incident(request, 'Unreadable payment callback', { body: request.body });
      return ACCEPTED;
    }
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.checkoutRequestId, cb.CheckoutRequestID));
    if (!payment) {
      await incident(request, 'Payment callback for an unknown prompt', { checkoutRequestId: cb.CheckoutRequestID });
      return ACCEPTED;
    }

    const code = Number(cb.ResultCode);
    if (code !== 0) {
      await applyStkOutcome(db, payment.id, {
        state: 'FAILED',
        reason: stkFailureReason(code),
        detail: cb.ResultDesc ?? `code ${code}`,
      });
      return ACCEPTED;
    }

    const item = (name: string) => cb.CallbackMetadata?.Item?.find(i => i.Name === name)?.Value;
    const receipt = String(item('MpesaReceiptNumber') ?? '');
    const paidCents = Math.round(Number(item('Amount')) * 100);
    if (!receipt || paidCents !== payment.amount) {
      // Money may have moved, but not as we asked: a person must look.
      await incident(
        request,
        'Payment callback does not match the payment',
        { paymentId: payment.id, expected: payment.amount, paid: paidCents, receipt },
        payment.jobId,
      );
      return ACCEPTED;
    }
    await applyStkOutcome(db, payment.id, { state: 'SUCCESS', receipt });
    return ACCEPTED;
  });
}
