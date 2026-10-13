import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CALL_OUT_PAYMENT_WINDOW_MS,
  STK_TIMEOUT_MS,
} from '../../src/domain/jobs/rules';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { jobEvents, payments, refunds, timers } from '../src/db/schema';
import {
  MAX_TIMER_ATTEMPTS,
  runDueTimers,
  startTimerWorker,
} from '../src/timers/worker';
import { booking, REPAIR, resetTables, WANJIRU } from './fixtures';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({ db });
});
beforeEach(() => resetTables(db));
afterAll(async () => {
  await app.close();
  await close();
});

const MINUTE = 60_000;

async function book() {
  const res = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers: WANJIRU,
    payload: booking(REPAIR),
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** A moment `ms` after the job was booked. */
const after = (job: { createdAt: string }, ms: number) =>
  new Date(Date.parse(job.createdAt) + ms);

const read = async (jobId: string) =>
  (await app.inject({ url: `/jobs/${jobId}`, headers: WANJIRU })).json();

const timersOf = (jobId: string) =>
  db.select().from(timers).where(eq(timers.jobId, jobId));

const eventsOf = (jobId: string) =>
  db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId));

async function startPayment(jobId: string, id = 'pay_1') {
  const at = new Date();
  await db.insert(payments).values({
    id,
    jobId,
    purpose: 'CALL_OUT',
    method: 'MPESA',
    phone: '254712345678',
    amount: 80000,
    status: 'PROCESSING',
    createdAt: at,
    updatedAt: at,
  });
}

describe('the call-out payment deadline', () => {
  it('is scheduled with the booking, 30 minutes out', async () => {
    const job = await book();
    expect(await timersOf(job.id)).toEqual([
      expect.objectContaining({
        kind: 'CALL_OUT_PAYMENT_DEADLINE',
        status: 'PENDING',
        dueAt: after(job, CALL_OUT_PAYMENT_WINDOW_MS),
      }),
    ]);
  });

  it('does nothing before it is due', async () => {
    const job = await book();
    const run = await runDueTimers(db, after(job, 29 * MINUTE));
    expect(run.fired).toBe(0);
    expect((await read(job.id)).status).toBe('CALL_OUT_PAYMENT_PENDING');
  });

  it('closes an unpaid booking once due, as the system', async () => {
    const job = await book();
    const run = await runDueTimers(db, after(job, 31 * MINUTE));

    expect(run).toEqual({ fired: 1, retried: 0, failed: 0 });
    expect(await read(job.id)).toMatchObject({
      status: 'CANCELLED',
      cancellation: {
        by: 'SYSTEM',
        reason: 'call_out_unpaid',
        fromStatus: 'CALL_OUT_PAYMENT_PENDING',
      },
    });
    const events = await eventsOf(job.id);
    expect(events.at(-1)).toMatchObject({
      toStatus: 'CANCELLED',
      actor: 'SYSTEM',
      metadata: { reason: 'call_out_unpaid' },
    });
    expect((await timersOf(job.id))[0].status).toBe('DONE');
    expect(await db.select().from(refunds)).toEqual([]); // nothing was paid
  });

  it('fires only once, however often the worker runs', async () => {
    const job = await book();
    await runDueTimers(db, after(job, 31 * MINUTE));
    const again = await runDueTimers(db, after(job, 40 * MINUTE));
    expect(again.fired).toBe(0);
    expect(await eventsOf(job.id)).toHaveLength(2);
  });

  it('does nothing if the customer already cancelled', async () => {
    const job = await book();
    await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/cancel`,
      headers: WANJIRU,
    });

    await runDueTimers(db, after(job, 31 * MINUTE));
    expect((await read(job.id)).cancellation.by).toBe('CUSTOMER');
    expect(await eventsOf(job.id)).toHaveLength(2);
    expect((await timersOf(job.id))[0].status).toBe('DONE');
  });

  it('waits for a customer who is entering their M-Pesa PIN', async () => {
    const job = await book();
    await startPayment(job.id);
    const now = after(job, 31 * MINUTE);

    const run = await runDueTimers(db, now);
    expect(run.retried).toBe(1);
    expect((await read(job.id)).status).toBe('CALL_OUT_PAYMENT_PENDING');
    const [timer] = await timersOf(job.id);
    expect(timer).toMatchObject({
      status: 'PENDING',
      dueAt: new Date(now.getTime() + STK_TIMEOUT_MS),
    });

    // The prompt times out without a PIN: now the booking closes.
    await db
      .update(payments)
      .set({ status: 'FAILED' })
      .where(eq(payments.id, 'pay_1'));
    await runDueTimers(db, new Date(now.getTime() + STK_TIMEOUT_MS));
    expect((await read(job.id)).status).toBe('CANCELLED');
  });
});

describe('the timer worker', () => {
  it('retries a failing timer with growing waits, then gives up and moves on', async () => {
    const job = await book();
    const at = after(job, 0);
    // A timer the code doesn't know how to run, standing in for a bug.
    await db.insert(timers).values({
      id: 'tmr_broken',
      jobId: job.id,
      kind: 'NOT_A_REAL_KIND' as 'CALL_OUT_PAYMENT_DEADLINE',
      dueAt: at,
      status: 'PENDING',
      createdAt: at,
      updatedAt: at,
    });

    let now = after(job, 31 * MINUTE);
    const first = await runDueTimers(db, now);
    // The broken timer didn't stop the real deadline from firing.
    expect(first).toEqual({ fired: 1, retried: 0, failed: 1 });
    expect((await read(job.id)).status).toBe('CANCELLED');

    const waits: number[] = [];
    for (let i = 1; i < MAX_TIMER_ATTEMPTS; i++) {
      const [t] = await db
        .select()
        .from(timers)
        .where(eq(timers.id, 'tmr_broken'));
      waits.push((t.dueAt.getTime() - now.getTime()) / MINUTE);
      now = t.dueAt;
      await runDueTimers(db, now);
    }
    expect(waits).toEqual([1, 2, 3, 4]);

    const [broken] = await db
      .select()
      .from(timers)
      .where(eq(timers.id, 'tmr_broken'));
    expect(broken).toMatchObject({
      status: 'FAILED',
      attempts: MAX_TIMER_ATTEMPTS,
      lastError: 'No handler for timer kind NOT_A_REAL_KIND',
    });
  });

  it('catches up on deadlines that passed while the server was down', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fundix-'));
    const dir = join(root, 'data', 'pglite');
    try {
      const first = await createDatabase({ dataDir: dir });
      await resetTables(first.db); // This database needs its accounts too.
      const before = buildApp({ db: first.db });
      const job = (
        await before.inject({
          method: 'POST',
          url: '/jobs',
          headers: WANJIRU,
          payload: booking(REPAIR),
        })
      ).json();
      // The server goes down, and comes back after the deadline.
      await first.db
        .update(timers)
        .set({ dueAt: new Date(Date.now() - MINUTE) })
        .where(eq(timers.jobId, job.id));
      await before.close();
      await first.close();

      const second = await createDatabase({ dataDir: dir });
      // Starting the worker checks straight away; stop() waits for that check.
      await startTimerWorker(second.db)();
      const res = await buildApp({ db: second.db }).inject({
        url: `/jobs/${job.id}`,
        headers: WANJIRU,
      });
      expect(res.json().status).toBe('CANCELLED');
      await second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
