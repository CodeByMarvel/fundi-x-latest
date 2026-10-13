import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import {
  charges,
  jobEvents,
  jobs,
  payments,
  quotes,
  refunds,
} from '../src/db/schema';
import {
  BRIAN,
  booking,
  OTIENO,
  REPAIR,
  resetTables,
  SERVICE,
  WANJIRU,
} from './fixtures';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;

// Starting PostgreSQL takes seconds, so one database serves the whole file
// and each test starts from empty tables instead.
beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({ db });
});
beforeEach(() => resetTables(db));
afterAll(async () => {
  await app.close();
  await close();
});

async function book(details = REPAIR, headers = WANJIRU) {
  const res = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers,
    payload: booking(details),
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('the API', () => {
  it('answers a health check', async () => {
    const res = await app.inject({ url: '/health' });
    expect(res.json()).toEqual({ ok: true });
  });

  it('refuses callers who say who they are not', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: booking(REPAIR),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthenticated');
  });

  it('lets only customers book', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: BRIAN,
      payload: booking(REPAIR),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /pricing/estimate', () => {
  it('prices a repair with the call-out only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pricing/estimate',
      headers: WANJIRU,
      payload: REPAIR,
    });
    expect(res.json()).toEqual({ pricingMode: 'QUOTED', callOut: 80000 });
  });

  it('prices catalog maintenance as fixed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pricing/estimate',
      headers: WANJIRU,
      payload: SERVICE,
    });
    expect(res.json().pricingMode).toBe('FIXED');
    expect(res.json().fixedService.total).toBe(570000);
  });
});

describe('POST /jobs', () => {
  it('books a job waiting for the call-out, with its charge and first event', async () => {
    const job = await book();
    expect(job).toMatchObject({
      status: 'CALL_OUT_PAYMENT_PENDING',
      pricingMode: 'QUOTED',
      customerId: 'wanjiru',
      vehicle: { registration: 'KDA 123A' },
    });

    const rows = await db
      .select()
      .from(charges)
      .where(eq(charges.jobId, job.id));
    expect(rows).toEqual([
      expect.objectContaining({ purpose: 'CALL_OUT', amount: 80000 }),
    ]);
    const events = await db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, job.id));
    expect(events).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'CALL_OUT_PAYMENT_PENDING',
        actor: 'CUSTOMER',
      }),
    ]);
  });

  it('books fixed-price maintenance with an approved Fundi-X quote', async () => {
    const job = await book(SERVICE);
    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.jobId, job.id));
    expect(quote).toMatchObject({
      kind: 'BASE',
      issuedBy: 'FUNDI_X',
      status: 'APPROVED',
      total: 570000,
    });
    expect(job.baseQuoteId).toBe(quote.id);
    const owed = await db
      .select()
      .from(charges)
      .where(eq(charges.jobId, job.id));
    expect(owed.map(c => c.purpose).sort()).toEqual(['CALL_OUT', 'SERVICE']);
  });

  it('refuses a booking at a price that is no longer current, saving nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: WANJIRU,
      payload: { ...REPAIR, acceptedPrice: { callOut: 100 } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('price_changed');
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it('rejects a malformed booking before any code runs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: WANJIRU,
      payload: { ...booking(REPAIR), urgency: 'yesterday' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('ignores fields a client should not set, like status', async () => {
    const job = (
      await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: WANJIRU,
        payload: { ...booking(REPAIR), status: 'COMPLETED', customerId: 'x' },
      })
    ).json();
    expect(job.status).toBe('CALL_OUT_PAYMENT_PENDING');
    expect(job.customerId).toBe('wanjiru');
  });
});

describe('GET /jobs/:id', () => {
  it('shows the customer their own job', async () => {
    const job = await book();
    const res = await app.inject({ url: `/jobs/${job.id}`, headers: WANJIRU });
    expect(res.json()).toEqual(job);
  });

  it("hides other people's jobs, as if they didn't exist", async () => {
    const job = await book();
    for (const headers of [OTIENO, BRIAN]) {
      const res = await app.inject({ url: `/jobs/${job.id}`, headers });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('POST /jobs/:id/cancel', () => {
  async function cancel(jobId: string, headers = WANJIRU) {
    return app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/cancel`,
      headers,
    });
  }

  it('cancels an unpaid booking: nothing to refund', async () => {
    const job = await book();
    const res = await cancel(job.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'CANCELLED',
      cancellation: {
        by: 'CUSTOMER',
        reason: 'customer_cancelled',
        fromStatus: 'CALL_OUT_PAYMENT_PENDING',
      },
    });
    expect(await db.select().from(refunds)).toEqual([]);

    const events = (
      await app.inject({ url: `/jobs/${job.id}/events`, headers: WANJIRU })
    ).json();
    expect(events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'CALL_OUT_PAYMENT_PENDING',
      'CANCELLED',
    ]);
  });

  it('refunds the call-out when cancelled while searching', async () => {
    const job = await book();
    // Stand in for the M-Pesa confirmation (a later slice): the call-out
    // reached escrow and matching started.
    const at = new Date();
    await db.insert(payments).values({
      id: 'pay_1',
      jobId: job.id,
      purpose: 'CALL_OUT',
      method: 'MPESA',
      phone: '254712345678',
      amount: 80000,
      status: 'SUCCESS',
      receiptNumber: 'SABC123XYZ',
      createdAt: at,
      updatedAt: at,
    });
    await db
      .update(jobs)
      .set({ status: 'SEARCHING' })
      .where(eq(jobs.id, job.id));

    await cancel(job.id);
    expect(await db.select().from(refunds)).toEqual([
      expect.objectContaining({
        paymentId: 'pay_1',
        amount: 80000,
        status: 'PENDING',
        reason: 'customer_cancelled',
      }),
    ]);
  });

  it('refuses to cancel twice, changing nothing', async () => {
    const job = await book();
    await cancel(job.id);
    const res = await cancel(job.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('job_transition');
    const events = await db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, job.id));
    expect(events).toHaveLength(2);
  });

  it("refuses to cancel someone else's job", async () => {
    const job = await book();
    expect((await cancel(job.id, OTIENO)).statusCode).toBe(404);
    expect((await cancel(job.id, BRIAN)).statusCode).toBe(404);
    const res = await app.inject({ url: `/jobs/${job.id}`, headers: WANJIRU });
    expect(res.json().status).toBe('CALL_OUT_PAYMENT_PENDING');
  });
});

describe('the database', () => {
  it('keeps jobs across a server restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fundix-'));
    // A nested folder that doesn't exist yet, like ./data/pglite on a
    // fresh checkout.
    const dir = join(root, 'data', 'pglite');
    try {
      const first = await createDatabase({ dataDir: dir });
      await resetTables(first.db); // This database needs its accounts too.
      const before = buildApp({ db: first.db });
      const booked = await before.inject({
        method: 'POST',
        url: '/jobs',
        headers: WANJIRU,
        payload: booking(REPAIR),
      });
      // Guards the comparison below: two identical errors would also match.
      expect(booked.statusCode).toBe(201);
      const created = booked.json();
      await before.close();
      await first.close();

      const second = await createDatabase({ dataDir: dir });
      const after = buildApp({ db: second.db });
      const res = await after.inject({
        url: `/jobs/${created.id}`,
        headers: WANJIRU,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(created);
      await after.close();
      await second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
