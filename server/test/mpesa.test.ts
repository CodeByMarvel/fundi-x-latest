import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STK_TIMEOUT_MS } from '../../src/domain/jobs/rules';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { incidents, payments } from '../src/db/schema';
import { checkBooks } from '../src/money/check';
import { MpesaError, type MpesaGateway, type StkOutcome } from '../src/mpesa/gateway';
import { reconcilePrompts } from '../src/mpesa/reconcile';
import { sendPrompt } from '../src/payments/service';
import { runDueTimers } from '../src/timers/worker';
import { BRIAN, booking, REPAIR, resetTables, WANJIRU } from './fixtures';

const SECRET = 'test-callback-secret-0123456789';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;

/** A pretend Daraja: records prompts; its answers are set per test. */
const fake = {
  sent: [] as { phone: string; shillings: number }[],
  refuse: false,
  query: { state: 'PENDING' } as StkOutcome,
};
const gateway: MpesaGateway = {
  name: 'daraja',
  async stkPush(request) {
    if (fake.refuse) {
      throw new MpesaError('M-Pesa refused the request (400) Invalid phone', false);
    }
    fake.sent.push(request);
    return { checkoutRequestId: `ws_CO_${fake.sent.length}`, merchantRequestId: `m${fake.sent.length}` };
  },
  async stkQuery() {
    return fake.query;
  },
  async b2c() {
    return { conversationId: 'AG_x' };
  },
};

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({ db, mpesa: gateway, mpesaCallbacks: { secret: SECRET, allowedIps: [] } });
});
beforeEach(async () => {
  await resetTables(db);
  fake.sent = [];
  fake.refuse = false;
  fake.query = { state: 'PENDING' };
  await ok('PUT', '/provider/availability', BRIAN, { online: true, location: REPAIR.location.coords });
});
afterAll(async () => {
  await app.close();
  await close();
});

async function ok(method: 'GET' | 'POST' | 'PUT', url: string, headers: Record<string, string>, payload?: object) {
  const res = await app.inject({ method, url, headers, ...(payload && { payload }) });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

/** Books a repair and asks for the call-out: the prompt is "on the phone". */
async function prompted() {
  const job = await ok('POST', '/jobs', WANJIRU, booking(REPAIR));
  const payment = await ok('POST', `/jobs/${job.id}/pay`, WANJIRU, { phone: '0700000001' });
  return { jobId: job.id as string, payment };
}

/** What Safaricom posts to the callback address. */
const callback = (checkoutRequestId: string, resultCode: number, amount = 800, receipt = 'SJK4H7Q2LX') => ({
  Body: {
    stkCallback: {
      MerchantRequestID: 'm1',
      CheckoutRequestID: checkoutRequestId,
      ResultCode: resultCode,
      ResultDesc: resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
      ...(resultCode === 0 && {
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: receipt },
            { Name: 'TransactionDate', Value: 20261021143000 },
            { Name: 'PhoneNumber', Value: 254700000001 },
          ],
        },
      }),
    },
  },
});

const postCallback = (body: object, secret = SECRET) =>
  app.inject({ method: 'POST', url: `/mpesa/${secret}/stk`, payload: body });

const status = async (jobId: string) => (await ok('GET', `/jobs/${jobId}`, WANJIRU)).status;

describe('M-Pesa Express (STK push) through Daraja', () => {
  it('sends the prompt in whole shillings and records M-Pesa’s ids', async () => {
    const { payment } = await prompted();
    expect(fake.sent).toEqual([expect.objectContaining({ phone: '254700000001', shillings: 800 })]);
    expect(payment.status).toBe('PENDING');
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.checkoutRequestId).toBe('ws_CO_1');
  });

  it('moves the job on when Safaricom confirms, once, however often it says so', async () => {
    const { jobId } = await prompted();
    const res = await postCallback(callback('ws_CO_1', 0));
    expect(res.json()).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    await postCallback(callback('ws_CO_1', 0)); // Safaricom resends
    expect(await status(jobId)).toBe('OFFERED');
    const money = await ok('GET', `/jobs/${jobId}/money`, WANJIRU);
    expect(money.payments).toMatchObject([{ status: 'SUCCESS', receiptNumber: 'SJK4H7Q2LX' }]);
    expect((await checkBooks(db)).ok).toBe(true);
  });

  it('records a cancelled prompt so the customer can try again', async () => {
    const { jobId } = await prompted();
    await postCallback(callback('ws_CO_1', 1032));
    const money = await ok('GET', `/jobs/${jobId}/money`, WANJIRU);
    expect(money.payments).toMatchObject([{ status: 'FAILED', failureReason: 'cancelled_by_user' }]);
    await ok('POST', `/jobs/${jobId}/pay`, WANJIRU, { phone: '0700000001' });
    expect(fake.sent).toHaveLength(2);
  });

  it('does not credit a callback that doesn’t match the payment, and flags it', async () => {
    const { jobId } = await prompted();
    await postCallback(callback('ws_CO_1', 0, 1)); // KSh 1, not 800
    expect(await status(jobId)).toBe('CALL_OUT_PAYMENT_PENDING');
    const [incident] = await db.select().from(incidents);
    expect(incident).toMatchObject({ kind: 'mpesa', title: 'Payment callback does not match the payment', jobId });

    await postCallback(callback('ws_CO_unknown', 0));
    expect(await db.select().from(incidents)).toHaveLength(2);
  });

  it('is not reachable without the secret', async () => {
    await prompted();
    expect((await postCallback(callback('ws_CO_1', 0), 'guessed-secret')).statusCode).toBe(404);
  });

  it('fails the payment, not the request, when M-Pesa won’t send the prompt', async () => {
    fake.refuse = true;
    const { payment } = await prompted();
    expect(payment).toMatchObject({ status: 'FAILED', failureReason: 'not_sent' });
  });

  it('hands Daraja’s reason for not sending to the log', async () => {
    const { payment } = await prompted();
    fake.refuse = true;
    const reasons: string[] = [];
    const failed = await sendPrompt(db, gateway, payment, err => reasons.push(err.message));
    expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'not_sent' });
    expect(reasons).toEqual(['M-Pesa refused the request (400) Invalid phone']);
  });

  it('records money that arrives after we gave up, and refunds it if the job moved on', async () => {
    const { jobId, payment } = await prompted();
    await db.update(payments).set({ status: 'FAILED', failureReason: 'timeout' }).where(eq(payments.id, payment.id));
    await ok('POST', `/jobs/${jobId}/cancel`, WANJIRU);

    await postCallback(callback('ws_CO_1', 0));
    const money = await ok('GET', `/jobs/${jobId}/money`, WANJIRU);
    expect(money.payments).toMatchObject([{ status: 'SUCCESS' }]);
    expect(money.refunds).toMatchObject([{ amount: 80_000, reason: 'job_closed_before_payment' }]);
    expect((await checkBooks(db)).ok).toBe(true);
  });
});

describe('when the callback never comes', () => {
  it('the timer leaves Daraja prompts to the reconciler', async () => {
    const { payment } = await prompted();
    await runDueTimers(db, new Date(Date.now() + STK_TIMEOUT_MS + 1000));
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe('PENDING');
  });

  it('asks M-Pesa, and settles the payment from its answer', async () => {
    const { jobId } = await prompted();
    const later = new Date(Date.now() + 90_000);
    expect(await reconcilePrompts(db, gateway, later)).toBe(0); // still on the phone

    fake.query = { state: 'SUCCESS', receipt: null };
    expect(await reconcilePrompts(db, gateway, later)).toBe(1);
    expect(await status(jobId)).toBe('OFFERED');
  });

  it('gives up after five minutes without an answer', async () => {
    const { payment } = await prompted();
    await reconcilePrompts(db, gateway, new Date(Date.now() + 6 * 60_000));
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'timeout' });
  });
});
