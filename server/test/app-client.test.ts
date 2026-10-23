import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobTransitionError } from '../../src/domain/jobs/transitions';
import { line, StaleQuoteError } from '../../src/domain/quotes/quotes';
import type { Backend } from '../../src/data/backend';
import { createAppSession } from '../src/accounts/sessions';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { booking, REPAIR, resetTables } from './fixtures';

/**
 * The phone app's real server client (src/data/server/serverBackend.ts)
 * against a running server, over HTTP, signed in with real sessions: the
 * same code path as the app on a phone, minus the screens.
 */

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;
let createServerBackend: typeof import('../../src/data/server/serverBackend').createServerBackend;
const clients: Backend[] = [];

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  process.env.TEST_API_URL = `http://127.0.0.1:${port}`;
  ({ createServerBackend } = await import('../../src/data/server/serverBackend'));
});
beforeEach(() => resetTables(db));
afterAll(async () => {
  clients.forEach(c => c.dispose?.());
  await app.close();
  await close();
});

const HOME = REPAIR.location.coords!;

/** Signs `userId` in (as the sign-in route would) and opens the app's client. */
async function signIn(userId: string, role: 'customer' | 'provider') {
  const fakeRequest = { ip: '127.0.0.1', headers: {} } as FastifyRequest;
  const { token } = await db.transaction(tx =>
    createAppSession(tx, userId, 'google', fakeRequest, new Date()),
  );
  const client = createServerBackend({ token, role });
  clients.push(client);
  return client;
}

/** Waits until `check` passes (the client polls, and the simulated phone answers in the background). */
async function until(check: () => unknown | Promise<unknown>, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // not yet
    }
    if (Date.now() > end) {
      throw new Error('Timed out waiting');
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

describe('the app talking to the server', () => {
  it('runs a repair from booking to payout, both sides', async () => {
    const customer = await signIn('wanjiru', 'customer');
    const mechanic = await signIn('p1', 'provider');

    const me = await mechanic.providers.setOnline('p1', true, HOME);
    expect(me).toMatchObject({ id: 'p1', online: true });

    // Customer: price, book, pay the call-out on the "phone".
    const estimate = await customer.pricing.estimate(REPAIR);
    expect(estimate.callOut).toBe(80_000);
    const job = await customer.jobs.createJob(booking(REPAIR));
    expect(customer.jobs.getJobSnapshot(job.id)?.status).toBe('CALL_OUT_PAYMENT_PENDING');
    const payment = await customer.billing.initiatePayment(job.id, '0700 000 001');
    expect(customer.billing.getPaymentSnapshot(payment.id)?.status).toBe('PENDING');
    customer.phone.respondToPaymentPrompt(payment.id, 'pay');

    // Mechanic: the offer arrives.
    await until(async () => (await mechanic.jobs.getJob(job.id))?.status === 'OFFERED');
    await mechanic.jobs.acceptOffer(job.id, 'p1');
    expect(mechanic.jobs.getJobSnapshot(job.id)?.status).toBe('ACCEPTED');
    expect(await mechanic.jobs.getCustomerContact(job.id)).toEqual({
      name: 'Wanjiru',
      phone: '254700000001',
    });
    await mechanic.jobs.startTrip(job.id, 'p1');
    await mechanic.providers.reportLocation(HOME);
    await mechanic.jobs.markArrived(job.id, 'p1');
    await mechanic.jobs.startInspection(job.id, 'p1');
    const quote = await mechanic.jobs.sendQuote(job.id, 'p1', [
      line('BRAKE_PAD_FRONT', 4500),
      line('LABOUR_BRAKE_PADS', 2000),
    ]);

    // Customer: sees who's coming, approves, pays the agreed price.
    await until(async () => {
      await customer.jobs.getJob(job.id);
      return customer.jobs.getJobSnapshot(job.id)?.status === 'QUOTE_SENT';
    });
    await until(() => customer.providers.getProviderSnapshot('p1')?.name === 'Brian');
    await customer.jobs.approveQuote(job.id, quote.id);
    const second = await customer.billing.initiatePayment(job.id, '0700000001');
    customer.phone.respondToPaymentPrompt(second.id, 'pay');
    await until(async () => (await mechanic.jobs.getJob(job.id))?.status === 'IN_PROGRESS');

    await mechanic.jobs.markWorkComplete(job.id, 'p1', 'Pads replaced');
    await until(async () => (await customer.jobs.getJob(job.id))?.status === 'AWAITING_CONFIRMATION');
    await customer.jobs.confirmCompletion(job.id);
    await customer.jobs.submitRating(job.id, 5, 'Quick and tidy');

    // The money, as each side sees it.
    expect(customer.billing.getPaymentsSnapshot().map(p => p.status)).toEqual(['SUCCESS', 'SUCCESS']);
    // The pads when paid for, then the call-out and labour on confirmation.
    await until(() => mechanic.billing.getReleasesSnapshot().length === 2);
    const payouts = mechanic.billing.getReleasesSnapshot();
    expect(payouts.every(r => r.jobId === job.id && r.providerId === 'p1')).toBe(true);
    expect(payouts.map(r => r.gross).sort((a, b) => a - b)).toEqual([80_000 + 200_000, 450_000]);
    expect(mechanic.billing.getPaymentsSnapshot()).toEqual([]); // never the customer's payments
    await until(() => mechanic.providers.getProviderSnapshot('p1')?.ratingCount === 1);
  }, 30_000);

  it('turns the server’s refusals into the errors the screens know', async () => {
    const customer = await signIn('wanjiru', 'customer');
    const job = await customer.jobs.createJob(booking(REPAIR));
    // Confirming before any work: not a move this status allows.
    await expect(customer.jobs.confirmCompletion(job.id)).rejects.toBeInstanceOf(JobTransitionError);
    await expect(customer.jobs.approveQuote(job.id, 'quote_nope')).rejects.toBeInstanceOf(
      StaleQuoteError,
    );
    await expect(customer.billing.initiatePayment(job.id, '123')).rejects.toMatchObject({
      name: 'PaymentError',
    });
  });
});
