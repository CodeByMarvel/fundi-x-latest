import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STK_TIMEOUT_MS } from '../../src/domain/jobs/rules';
import { line } from '../../src/domain/quotes/quotes';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { payments, refunds } from '../src/db/schema';
import { paymentSucceeded } from '../src/payments/service';
import { runDueTimers } from '../src/timers/worker';
import { BRIAN, booking, OTIENO, REPAIR, resetTables, SERVICE, WANJIRU } from './fixtures';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({ db });
});
beforeEach(async () => {
  await resetTables(db);
  await call('PUT', '/provider/availability', BRIAN, { online: true, location: HOME });
});
afterAll(async () => {
  await app.close();
  await close();
});

const HOME = REPAIR.location.coords!;
type Headers = Record<string, string>;

const call = (method: 'GET' | 'POST' | 'PUT', url: string, headers: Headers, payload?: object) =>
  app.inject({ method, url, headers, ...(payload && { payload }) });

async function ok(method: 'GET' | 'POST' | 'PUT', url: string, headers: Headers, payload?: object) {
  const res = await call(method, url, headers, payload);
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

const pay = (jobId: string, body: object = { phone: '0700 000 001' }) =>
  call('POST', `/jobs/${jobId}/pay`, WANJIRU, body);

/** Starts a payment and answers the simulated PIN prompt. */
async function payAndAnswer(jobId: string, response = 'pay', body?: object) {
  const res = await pay(jobId, body);
  expect(res.statusCode, res.body).toBe(201);
  await ok('POST', `/dev/payments/${res.json().id}/respond`, WANJIRU, { response });
  return res.json();
}

async function book(details = REPAIR) {
  return ok('POST', '/jobs', WANJIRU, booking(details));
}

const job = (id: string, headers: Headers = WANJIRU) => ok('GET', `/jobs/${id}`, headers);

describe('paying the call-out', () => {
  it('charges what the server says, then starts matching once M-Pesa confirms', async () => {
    const { id } = await book();
    const payment = (await pay(id)).json();
    expect(payment).toMatchObject({
      status: 'PENDING',
      purpose: 'CALL_OUT',
      phone: '254700000001', // normalised
      amount: 80_000,
    });
    expect((await job(id)).status).toBe('CALL_OUT_PAYMENT_PENDING');

    await ok('POST', `/dev/payments/${payment.id}/respond`, WANJIRU, { response: 'pay' });
    expect((await job(id)).status).toBe('OFFERED');
    const money = await ok('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.payments[0]).toMatchObject({ status: 'SUCCESS' });
    expect(money.payments[0].receiptNumber).toMatch(/^S[A-Z0-9]{9}$/);
  });

  it('allows one prompt at a time, and a new one after a failure', async () => {
    const { id } = await book();
    const first = (await pay(id)).json();
    expect((await pay(id)).json().error).toBe('payment_refused');
    await ok('POST', `/dev/payments/${first.id}/respond`, WANJIRU, { response: 'insufficient_funds' });
    const money = await ok('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.payments[0]).toMatchObject({ status: 'FAILED', failureReason: 'insufficient_funds' });
    expect((await pay(id)).statusCode).toBe(201);
  });

  it('refuses a bad phone number and someone else’s job', async () => {
    const { id } = await book();
    expect((await pay(id, { phone: '12345' })).json().error).toBe('payment_refused');
    const stranger = await call('POST', `/jobs/${id}/pay`, OTIENO, { phone: '0700000002' });
    expect(stranger.statusCode).toBe(404);
  });

  it('fails a prompt nobody answers, so the customer can try again', async () => {
    const { id } = await book();
    const payment = (await pay(id)).json();
    await runDueTimers(db, new Date(Date.now() + STK_TIMEOUT_MS + 1000));
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'timeout' });
  });

  it('counts a confirmation that arrives twice only once', async () => {
    const { id } = await book();
    const payment = (await pay(id)).json();
    const at = new Date();
    await db.transaction(tx => paymentSucceeded(tx, payment.id, 'SAAA000001', at));
    await db.transaction(tx => paymentSucceeded(tx, payment.id, 'SAAA000001', at));
    expect((await job(id)).status).toBe('OFFERED');
    expect(await db.select().from(refunds)).toHaveLength(0);
  });

  it('refunds money that arrives after the customer cancelled', async () => {
    const { id } = await book();
    const payment = (await pay(id)).json();
    await ok('POST', `/jobs/${id}/cancel`, WANJIRU);
    await ok('POST', `/dev/payments/${payment.id}/respond`, WANJIRU, { response: 'pay' });
    const money = await ok('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.refunds).toMatchObject([
      { paymentId: payment.id, amount: 80_000, reason: 'job_closed_before_payment' },
    ]);
  });
});

describe('paying for the work', () => {
  /** Booked, paid, accepted and arrived. */
  async function arrived(details = REPAIR) {
    const { id } = await book(details);
    await payAndAnswer(id);
    for (const step of ['accept', 'start-trip', 'arrived']) {
      await ok('POST', `/jobs/${id}/${step}`, BRIAN);
    }
    return id;
  }

  it('starts the work once the agreed price of a service is in escrow', async () => {
    const id = await arrived(SERVICE);
    await ok('POST', `/jobs/${id}/ready-to-start`, BRIAN);
    const payment = await payAndAnswer(id);
    expect(payment.purpose).toBe('SERVICE');
    expect((await job(id)).status).toBe('IN_PROGRESS');
  });

  it('approves extra work by paying for it', async () => {
    const id = await arrived();
    await ok('POST', `/jobs/${id}/start-inspection`, BRIAN);
    const quote = await ok('POST', `/jobs/${id}/quote`, BRIAN, {
      items: [line('BRAKE_PAD_FRONT', 4500), line('LABOUR_BRAKE_PADS', 2000)],
    });
    await ok('POST', `/jobs/${id}/approve-quote`, WANJIRU, { quoteId: quote.id });
    await payAndAnswer(id);
    const extra = await ok('POST', `/jobs/${id}/additional-quote`, BRIAN, {
      items: [line('BRAKE_DISC_FRONT', 6000)],
      reason: 'Discs worn',
    });

    const payment = await payAndAnswer(id, 'pay', { phone: '0700000001', quoteId: extra.id });
    expect(payment).toMatchObject({ purpose: 'SERVICE', amount: extra.total });
    const quotes = await ok('GET', `/jobs/${id}/quotes`, WANJIRU);
    expect(quotes.find((q: { id: string }) => q.id === extra.id).status).toBe('APPROVED');
    const money = await ok('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.charges.map((c: { description: string }) => c.description)).toContain(
      'Additional: Discs worn',
    );
    // The mechanic can finish now that nothing is waiting.
    expect((await ok('POST', `/jobs/${id}/complete`, BRIAN)).status).toBe('AWAITING_CONFIRMATION');
  });
});

describe('what each side can read', () => {
  it('shows the mechanic their payout, never the customer’s payments', async () => {
    const { id } = await book();
    await payAndAnswer(id);
    await ok('POST', `/jobs/${id}/accept`, BRIAN);
    const forMechanic = await ok('GET', `/jobs/${id}/money`, BRIAN);
    expect(forMechanic).toEqual({ charges: [], payments: [], refunds: [], releases: [] });
  });

  it('gives the mechanic the customer’s number only while the job is under way', async () => {
    const { id } = await book();
    await payAndAnswer(id);
    expect((await call('GET', `/jobs/${id}/contact`, BRIAN)).statusCode).toBe(404); // only offered
    await ok('POST', `/jobs/${id}/accept`, BRIAN);
    expect(await ok('GET', `/jobs/${id}/contact`, BRIAN)).toEqual({
      name: 'Wanjiru',
      phone: '254700000001',
    });
    await ok('POST', `/jobs/${id}/withdraw`, BRIAN);
    expect((await call('GET', `/jobs/${id}/contact`, BRIAN)).statusCode).toBe(404);
  });

  it('lets a customer see the mechanic on their job, and nobody else', async () => {
    const { id } = await book();
    await payAndAnswer(id);
    expect((await call('GET', '/providers/p1', WANJIRU)).statusCode).toBe(404); // not yet theirs
    await ok('POST', `/jobs/${id}/accept`, BRIAN);
    expect(await ok('GET', '/providers/p1', WANJIRU)).toMatchObject({
      id: 'p1',
      name: 'Brian',
      phone: '254712000101',
      distanceKm: 0,
    });
    expect((await call('GET', '/providers/p1', OTIENO)).statusCode).toBe(404);
  });

  it('gives the mechanic their own profile and record', async () => {
    const me = await ok('GET', '/provider/me', BRIAN);
    expect(me.provider).toMatchObject({ id: 'p1', online: true, rating: 0, ratingCount: 0 });
    expect(me.reliability).toEqual([]);
    expect(await ok('GET', '/provider/releases', BRIAN)).toEqual([]);
  });
});

describe('the payment simulator', () => {
  it('is not there when switched off (production)', async () => {
    const prod = buildApp({ db, simulatePayments: false });
    const res = await prod.inject({
      method: 'POST',
      url: '/dev/payments/pay_x/respond',
      headers: WANJIRU,
      payload: { response: 'pay' },
    });
    expect(res.statusCode).toBe(404);
    await prod.close();
  });
});
