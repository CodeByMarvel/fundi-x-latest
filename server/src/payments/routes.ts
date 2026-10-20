import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { callerOf, requireCustomer } from '../auth';
import type { Database } from '../db/client';
import { payments } from '../db/schema';
import { NotFoundError } from '../errors';
import { findJob } from '../jobs/store';
import { jobIdParams } from '../jobs/schemas';
import type { MpesaGateway } from '../mpesa/gateway';
import { jobMoney, paymentFailed, paymentSucceeded, sendPrompt, startPayment } from './service';

type JobParams = { Params: { id: string } };

/**
 * `simulatePayments` (development only, never in production) adds a
 * stand-in for the customer's phone: the app's "simulated M-Pesa" sheet
 * answers the PIN prompt here instead of on a real handset.
 */
export function registerPaymentRoutes(
  app: FastifyInstance,
  db: Database,
  { simulatePayments, mpesa }: { simulatePayments: boolean; mpesa: MpesaGateway },
) {
  app.post<JobParams & { Body: { phone: string; quoteId?: string } }>(
    '/jobs/:id/pay',
    {
      schema: {
        params: jobIdParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['phone'],
          properties: {
            phone: { type: 'string', minLength: 1, maxLength: 20 },
            quoteId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const { phone, quoteId } = request.body;
      const payment = await startPayment(db, callerOf(request), request.params.id, phone, quoteId);
      // The app watches the payment: PENDING while the prompt is on the
      // phone, or FAILED (not_sent) if M-Pesa couldn't send it.
      return reply.status(201).send(await sendPrompt(db, mpesa, payment));
    },
  );

  /** Charges, payments, refunds and payouts for one job. */
  app.get<JobParams>(
    '/jobs/:id/money',
    { schema: { params: jobIdParams } },
    async request => jobMoney(db, callerOf(request), request.params.id),
  );

  // The simulated phone only answers simulated prompts.
  if (!simulatePayments || mpesa.name !== 'simulator') {
    return;
  }

  app.post<{
    Params: { id: string };
    Body: { response: 'pay' | 'cancel' | 'insufficient_funds' };
  }>(
    '/dev/payments/:id/respond',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['response'],
          properties: { response: { enum: ['pay', 'cancel', 'insufficient_funds'] } },
        },
      },
    },
    async request => {
      const caller = requireCustomer(request);
      const [row] = await db.select().from(payments).where(eq(payments.id, request.params.id));
      if (!row || (await findJob(db, row.jobId)).customerId !== caller.id) {
        throw new NotFoundError('Payment');
      }
      const at = new Date();
      const { response } = request.body;
      await db.transaction(tx =>
        response === 'pay'
          ? paymentSucceeded(tx, row.id, simulatedReceipt(), at)
          : paymentFailed(tx, row.id, response === 'cancel' ? 'cancelled_by_user' : 'insufficient_funds', at),
      );
      return { ok: true };
    },
  );
}

/** Looks like a real M-Pesa code: "S" and nine letters or digits. */
function simulatedReceipt() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  return 'S' + Array.from({ length: 9 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
