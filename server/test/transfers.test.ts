import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { incidents, transfers } from '../src/db/schema';
import { bookTotals, checkBooks } from '../src/money/check';
import { runTransfers } from '../src/money/transfers';
import { MpesaError, type MpesaGateway } from '../src/mpesa/gateway';
import { adminHarness } from './adminHarness';
import { BRIAN, REPAIR, SERVICE, WANJIRU } from './fixtures';

const SECRET = 'test-callback-secret-0123456789';

/** A pretend Daraja for B2C: records what was sent; can be made to fail. */
const fake = { sent: [] as { transferId: string; phone: string; shillings: number }[], fail: null as MpesaError | null };
const gateway: MpesaGateway = {
  name: 'daraja',
  async stkPush() {
    return { checkoutRequestId: `ws_CO_${Math.random()}`, merchantRequestId: 'm' };
  },
  async stkQuery() {
    return { state: 'PENDING' };
  },
  async b2c(request) {
    if (fake.fail) {
      throw fake.fail;
    }
    fake.sent.push(request);
    return { conversationId: `AG_${request.transferId}` };
  },
};

let db: Database;
let close: () => Promise<void>;
let h: ReturnType<typeof adminHarness>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  h = adminHarness(db, { mpesa: gateway, mpesaCallbacks: { secret: SECRET, allowedIps: [] } });
});
beforeEach(async () => {
  await h.reset();
  fake.sent = [];
  fake.fail = null;
});
afterAll(async () => {
  await h.app.close();
  await close();
});

/** Pays through the STK callback, as Safaricom would. */
async function payByCallback(jobId: string) {
  const payment = await h.appOk('POST', `/jobs/${jobId}/pay`, WANJIRU, { phone: '0700000001' });
  const { checkoutRequestId } = (await h.staffOk('GET', `/jobs/${jobId}`)).payments.find(
    (p: { id: string }) => p.id === payment.id,
  );
  await h.app.inject({
    method: 'POST',
    url: `/mpesa/${SECRET}/stk`,
    payload: {
      Body: {
        stkCallback: {
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: payment.amount / 100 },
              { Name: 'MpesaReceiptNumber', Value: `S${payment.id.slice(-9).toUpperCase().replace(/[^A-Z0-9]/g, '0')}` },
            ],
          },
        },
      },
    },
  });
}

/** What Safaricom posts when a B2C transfer ends. */
const result = (transferId: string, code: number, shillings: number, receipt = 'SKL9X2ABCD') => ({
  Result: {
    ResultType: 0,
    ResultCode: code,
    ResultDesc: code === 0 ? 'The service request is processed successfully.' : 'The initiator information is invalid.',
    OriginatorConversationID: transferId,
    ConversationID: `AG_${transferId}`,
    TransactionID: receipt,
    ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: shillings }] },
  },
});
const postResult = (body: object) => h.app.inject({ method: 'POST', url: `/mpesa/${SECRET}/b2c/result`, payload: body });

/** A completed oil change with parts: two payouts queued for Brian. */
async function completedService() {
  await h.appOk('PUT', '/provider/availability', BRIAN, { online: true, location: REPAIR.location.coords });
  const job = await h.appOk('POST', '/jobs', WANJIRU, (await import('./fixtures')).booking(SERVICE));
  await payByCallback(job.id);
  for (const step of ['accept', 'start-trip', 'arrived', 'ready-to-start']) {
    await h.appOk('POST', `/jobs/${job.id}/${step}`, BRIAN);
  }
  await payByCallback(job.id);
  await h.appOk('POST', `/jobs/${job.id}/complete`, BRIAN, {});
  await h.appOk('POST', `/jobs/${job.id}/confirm`, WANJIRU);
  return job.id as string;
}

describe('payouts to mechanics', () => {
  it('queues a payout with each release and sends it to the payout number', async () => {
    await completedService();
    const queued = await db.select().from(transfers);
    expect(queued.map(t => [t.kind, t.amount, t.status])).toEqual([
      ['PAYOUT', 465_500, 'QUEUED'], // parts: 4,900 − 245
      ['PAYOUT', 128_000, 'QUEUED'], // call-out + labour: 1,600 − 320
    ]);

    expect(await runTransfers(db, gateway)).toBe(2);
    expect(fake.sent.map(s => [s.phone, s.shillings])).toEqual([
      ['254712000101', 4655],
      ['254712000101', 1280],
    ]);
    expect((await db.select().from(transfers)).every(t => t.status === 'SENT')).toBe(true);
    expect(await runTransfers(db, gateway)).toBe(0); // never sent twice
  });

  it('records the money as sent when Safaricom confirms, once', async () => {
    await completedService();
    await runTransfers(db, gateway);
    for (const t of await db.select().from(transfers)) {
      await postResult(result(t.id, 0, t.amount / 100));
      await postResult(result(t.id, 0, t.amount / 100)); // resent
    }
    expect((await db.select().from(transfers)).every(t => t.status === 'SUCCESS')).toBe(true);
    expect(await bookTotals(db)).toEqual({
      mpesa: 650_000 - 465_500 - 128_000, // Fundi-X's commission is all that's left
      escrow: 0,
      owedToMechanics: 0,
      owedToCustomers: 0,
      revenue: 56_500,
    });
    expect((await checkBooks(db)).ok).toBe(true);
  });

  it('keeps the money owed when a transfer fails, and staff can retry it', async () => {
    await completedService();
    await runTransfers(db, gateway);
    const [first] = await db.select().from(transfers);
    await postResult(result(first.id, 2001, first.amount / 100));

    const [failed] = await db.select().from(transfers).where(eq(transfers.id, first.id));
    expect(failed).toMatchObject({ status: 'FAILED', lastError: expect.stringMatching(/2001/) });
    expect((await bookTotals(db)).owedToMechanics).toBe(465_500 + 128_000);
    expect((await db.select().from(incidents)).map(i => i.title)).toContain('M-Pesa transfer failed');
    expect((await h.staffOk('GET', '/dashboard')).money.transfersFailed).toBe(1);

    await h.staffOk('POST', `/transfers/${first.id}/retry`, { reason: 'Initiator password reset' });
    fake.sent = [];
    await runTransfers(db, gateway);
    expect(fake.sent).toEqual([expect.objectContaining({ transferId: first.id, shillings: 4655 })]);
  });

  it('retries by itself while M-Pesa is busy, then stops for a person', async () => {
    await completedService();
    fake.fail = new MpesaError('M-Pesa could not be reached', true);
    let now = new Date();
    await runTransfers(db, gateway, now);
    expect((await db.select().from(transfers)).every(t => t.status === 'QUEUED' && t.attempts === 1)).toBe(true);

    for (let i = 0; i < 5; i++) {
      now = new Date(now.getTime() + 2 * 3_600_000);
      await runTransfers(db, gateway, now);
    }
    expect((await db.select().from(transfers)).every(t => t.status === 'FAILED')).toBe(true);
  });

  it('lets staff record a transfer they found on the M-Pesa statement', async () => {
    await completedService();
    fake.fail = new MpesaError('Initiator not allowed', false);
    await runTransfers(db, gateway);
    const [t] = await db.select().from(transfers);
    const bad = await h.staff('POST', `/transfers/${t.id}/mark-sent`, { reason: 'Seen on statement', receipt: 'nope' });
    expect(bad.statusCode).toBe(400);
    await h.staffOk('POST', `/transfers/${t.id}/mark-sent`, { reason: 'Seen on the statement', receipt: 'SKL9X2ABCD' });
    const [done] = await db.select().from(transfers).where(eq(transfers.id, t.id));
    expect(done).toMatchObject({ status: 'SUCCESS', receiptNumber: 'SKL9X2ABCD' });
    expect((await checkBooks(db)).ok).toBe(true);
  });
});

describe('refunds to customers', () => {
  it('sends the refund back to the number that paid, and marks it sent', async () => {
    await h.appOk('PUT', '/provider/availability', BRIAN, { online: true, location: REPAIR.location.coords });
    const { id } = await h.appOk('POST', '/jobs', WANJIRU, (await import('./fixtures')).booking(REPAIR));
    await payByCallback(id);
    await h.appOk('POST', `/jobs/${id}/accept`, BRIAN);
    await h.staffOk('POST', `/jobs/${id}/cancel`, { reason: 'Mechanic disappeared' });
    await runTransfers(db, gateway);
    expect(fake.sent).toEqual([expect.objectContaining({ phone: '254700000001', shillings: 800 })]);

    const [t] = await db.select().from(transfers);
    expect(t.kind).toBe('REFUND');
    await postResult(result(t.id, 0, 800));
    const money = await h.appOk('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.refunds).toMatchObject([{ status: 'SUCCESS' }]);
    expect(await bookTotals(db)).toMatchObject({ mpesa: 0, owedToCustomers: 0 });
  });
});
