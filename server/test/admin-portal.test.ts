import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kes } from '../../src/domain/money';
import { ensureOwner } from '../src/admin/bootstrap';
import { startOfNairobiDay } from '../src/admin/dashboard';
import { googleVerifier } from '../src/admin/google';
import { SESSION_COOKIE } from '../src/admin/session';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { auditLog, incidents, timers } from '../src/db/schema';
import { runDueTimers, MAX_TIMER_ATTEMPTS } from '../src/timers/worker';
import { booking, OTIENO, REPAIR, resetTables, SERVICE, WANJIRU } from './fixtures';

const ORIGIN = 'http://admin.test';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;
let cookies: Record<string, string>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({
    db,
    admin: {
      verifyGoogle: googleVerifier(undefined),
      googleClientId: null,
      origin: ORIGIN,
      secureCookie: false,
      devSignIn: true,
    },
    signInPerMinute: 1000, // many sign-ins per minute in tests
  });
  // A route that always breaks, standing in for a real bug.
  app.get('/test/boom', async () => {
    throw new TypeError("Cannot read properties of undefined (reading 'x')");
  });
});
beforeEach(async () => {
  await resetTables(db);
  await ensureOwner(db, 'owner@example.com');
  const res = await app.inject({
    method: 'POST',
    url: '/admin/auth/dev',
    headers: { origin: ORIGIN },
  });
  cookies = { [SESSION_COOKIE]: res.cookies.find(c => c.name === SESSION_COOKIE)!.value };
});
afterAll(async () => {
  await app.close();
  await close();
});

const get = (url: string) => app.inject({ url, cookies });
const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, cookies, payload: payload as object });

async function book(details = REPAIR, headers = WANJIRU) {
  const res = await app.inject({ method: 'POST', url: '/jobs', headers, payload: booking(details) });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('reasons', () => {
  it('are required to change a setting, and kept in the audit log', async () => {
    const put = (payload: object) =>
      app.inject({
        method: 'PUT',
        url: '/admin/settings/call_out_fee',
        headers: { origin: ORIGIN },
        cookies,
        payload,
      });
    expect((await put({ value: kes(900) })).statusCode).toBe(400);
    expect((await put({ value: kes(900), reason: '   ' })).statusCode).toBe(400);
    expect((await put({ value: kes(900), reason: 'Fuel prices went up' })).statusCode).toBe(200);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'settings.update'));
    expect(entry.reason).toBe('Fuel prices went up');
  });
});

describe('request ids', () => {
  it('come back on every response and in every error', async () => {
    const ok = await app.inject({ url: '/health' });
    expect(ok.headers['x-request-id']).toMatch(/^req_/);

    const err = await app.inject({ url: '/jobs/nope', headers: WANJIRU });
    expect(err.json().requestId).toBe(err.headers['x-request-id']);
  });

  it('cannot be chosen by the caller', async () => {
    const res = await app.inject({ url: '/health', headers: { 'request-id': 'mine' } });
    expect(res.headers['x-request-id']).not.toBe('mine');
  });
});

describe('incidents', () => {
  it('are recorded for server errors, with the request id', async () => {
    const res = await app.inject({ url: '/test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe('Something went wrong'); // no internals leak out

    const [incident] = await db.select().from(incidents);
    expect(incident).toMatchObject({
      kind: 'server_error',
      status: 'OPEN',
      count: 1,
      lastRequestId: res.json().requestId,
    });
    expect(incident.title).toContain('TypeError');
  });

  it('group repeats of the same problem into one', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({ url: '/test/boom' });
    }
    const all = await db.select().from(incidents);
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(3);
  });

  it('are not raised for the caller\'s mistakes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: { ...WANJIRU, 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(await db.select().from(incidents)).toHaveLength(0);
  });

  it('are resolved with a note; a repeat afterwards opens a new one', async () => {
    await app.inject({ url: '/test/boom' });
    const [open] = (await get('/admin/incidents')).json();

    expect((await post(`/admin/incidents/${open.id}/resolve`, {})).statusCode).toBe(400);
    const res = await post(`/admin/incidents/${open.id}/resolve`, { reason: 'Fixed in the next release' });
    expect(res.json()).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Fixed in the next release' });
    expect((await get('/admin/incidents')).json()).toHaveLength(0);

    await app.inject({ url: '/test/boom' });
    expect((await get('/admin/incidents')).json()).toHaveLength(1);
    expect((await get('/admin/incidents?status=RESOLVED')).json()).toHaveLength(1);
  });

  it('are raised when a timer gives up, linked to its job; the timer can be retried', async () => {
    const job = await book();
    await db
      .update(timers)
      .set({ kind: 'NOT_A_REAL_KIND' as never, attempts: MAX_TIMER_ATTEMPTS - 1, dueAt: new Date(0) })
      .where(eq(timers.jobId, job.id));
    await runDueTimers(db);

    const [incident] = await db.select().from(incidents);
    expect(incident).toMatchObject({ kind: 'timer_failed', jobId: job.id });

    const { failed } = (await get('/admin/timers/attention')).json();
    expect(failed).toHaveLength(1);
    expect((await post(`/admin/timers/${failed[0].id}/retry`, {})).statusCode).toBe(400);
    const retry = await post(`/admin/timers/${failed[0].id}/retry`, { reason: 'Handler deployed' });
    expect(retry.statusCode).toBe(200);
    const [timer] = await db.select().from(timers).where(eq(timers.id, failed[0].id));
    expect(timer).toMatchObject({ status: 'PENDING', attempts: 0 });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'timer.retry'));
    expect(entry.reason).toBe('Handler deployed');
  });
});

describe('system health', () => {
  it('reports the database, timers and open incidents', async () => {
    await book();
    await app.inject({ url: '/test/boom' });
    const health = (await get('/admin/health')).json();
    expect(health).toMatchObject({
      database: { ok: true },
      timersPending: 1,
      timersOverdue: 0,
      timersFailed: 0,
      incidentsOpen: 1,
    });
  });

  it('needs logs.view', async () => {
    expect((await app.inject({ url: '/admin/health' })).statusCode).toBe(401);
  });
});

describe('jobs', () => {
  it('can be searched by plate (any spacing), customer, phone or id', async () => {
    const a = await book(REPAIR, WANJIRU);
    const b = await book(SERVICE, OTIENO);
    const ids = async (q: string) =>
      (await get(`/admin/jobs?q=${encodeURIComponent(q)}`)).json().map((j: { id: string }) => j.id);

    expect(await ids('kda123a')).toEqual([b.id, a.id]); // both use KDA 123A
    expect(await ids('otieno')).toEqual([b.id]);
    expect(await ids('254700000001')).toEqual([a.id]);
    expect(await ids(a.id.slice(4, 14))).toEqual([a.id]);
    expect(await ids('%')).toEqual([]); // a wildcard is just a character
  });

  it('list customer and filter by status', async () => {
    await book();
    const [row] = (await get('/admin/jobs?status=CALL_OUT_PAYMENT_PENDING')).json();
    expect(row.customer).toMatchObject({ name: 'Wanjiru', phone: '254700000001' });
    expect(row.provider).toBeNull();
    expect((await get('/admin/jobs?status=COMPLETED')).json()).toHaveLength(0);
  });

  it('show everything about one job', async () => {
    const job = await book(SERVICE);
    const detail = (await get(`/admin/jobs/${job.id}`)).json();
    expect(detail.job).toMatchObject({ id: job.id, status: 'CALL_OUT_PAYMENT_PENDING', pricingMode: 'FIXED' });
    expect(detail.customer.name).toBe('Wanjiru');
    expect(detail.events).toHaveLength(1);
    expect(detail.charges.map((c: { purpose: string }) => c.purpose)).toEqual(['CALL_OUT', 'SERVICE', 'PARTS']);
    expect(detail.quotes).toHaveLength(1);
    expect(detail.timers[0].kind).toBe('CALL_OUT_PAYMENT_DEADLINE');
    expect(detail.money).toMatchObject({ paid: 0, heldInEscrow: 0 });
    expect(detail.money.charged).toBeGreaterThan(0);
  });

  it('answer 404 for an unknown job', async () => {
    expect((await get('/admin/jobs/job_missing')).statusCode).toBe(404);
  });
});

describe('dashboard', () => {
  it('counts active jobs by stage and today\'s jobs', async () => {
    await book();
    await book(SERVICE, OTIENO);
    const dash = (await get('/admin/dashboard')).json();
    expect(dash.jobs.active).toEqual({ CALL_OUT_PAYMENT_PENDING: 2 });
    expect(dash.jobs.today).toEqual({ created: 2, completed: 0, cancelled: 0 });
    expect(dash.system.incidentsOpen).toBe(0);
    expect(dash.settings.callOutFee).toBeGreaterThan(0);
  });

  it('flags mechanics more than 20 minutes past their promised arrival', async () => {
    const onTime = await book();
    const late = await book(SERVICE, OTIENO);
    const enRoute = (id: string, minutesAgo: number) =>
      db.execute(sql`
        update jobs set status = 'EN_ROUTE',
          extra = extra || jsonb_build_object('expectedArrivalAt', ${new Date(Date.now() - minutesAgo * 60_000).toISOString()}::text)
        where id = ${id}`);
    await enRoute(onTime.id, 10); // a little late, still within the grace
    await enRoute(late.id, 25);
    expect((await get('/admin/dashboard')).json().jobs.lateArrivals).toBe(1);
  });

  it('starts "today" at midnight Nairobi time', () => {
    // 22:30 UTC on the 12th is already 01:30 on the 13th in Nairobi.
    expect(startOfNairobiDay(new Date('2026-10-12T22:30:00Z')).toISOString()).toBe(
      '2026-10-12T21:00:00.000Z',
    );
  });
});
