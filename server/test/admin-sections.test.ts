import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { auditLog, jobEvents, providers, reliabilityEvents, users } from '../src/db/schema';
import { adminHarness } from './adminHarness';
import { BRIAN, OTIENO, REPAIR, SERVICE, WANJIRU } from './fixtures';

let db: Database;
let close: () => Promise<void>;
let h: ReturnType<typeof adminHarness>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  h = adminHarness(db);
});
beforeEach(() => h.reset());
afterAll(async () => {
  await h.app.close();
  await close();
});

/** An oil change with parts, done and waiting for the customer to confirm. */
async function finishedService() {
  const id = await h.arrived(SERVICE);
  await h.appOk('POST', `/jobs/${id}/ready-to-start`, BRIAN);
  await h.pay(id);
  await h.appOk('POST', `/jobs/${id}/complete`, BRIAN, {});
  return id;
}

async function disputed() {
  const id = await finishedService();
  await h.appOk('POST', `/jobs/${id}/dispute`, WANJIRU, { reason: 'Oil is leaking' });
  return id;
}

describe('customer care: disputes', () => {
  it('lists open disputes with what is still held, parts excluded', async () => {
    const id = await disputed();
    const [row] = await h.staffOk('GET', '/disputes');
    expect(row).toMatchObject({
      id,
      status: 'DISPUTED',
      dispute: { reason: 'Oil is leaking' },
      // Call-out KSh 800 + labour KSh 800; the parts were paid out already.
      heldInEscrow: 160_000,
      customer: { name: 'Wanjiru' },
      provider: { name: 'Brian' },
    });
    expect(await h.staffOk('GET', '/disputes?state=resolved')).toEqual([]);
  });

  it('splits exactly what is held, and records who decided and why', async () => {
    const id = await disputed();
    const wrong = await h.staff('POST', `/jobs/${id}/resolve-dispute`, {
      outcome: 'SPLIT',
      reason: 'Half the work was poor',
      customerRefund: 100_000,
      providerPayout: 100_000,
    });
    expect(wrong.statusCode).toBe(400);

    const job = await h.staffOk('POST', `/jobs/${id}/resolve-dispute`, {
      outcome: 'SPLIT',
      reason: 'Half the work was poor',
      customerRefund: 80_000,
      providerPayout: 80_000,
    });
    expect(job).toMatchObject({ status: 'CANCELLED', cancellation: { reason: 'dispute_resolved' } });
    expect(job.dispute.resolution).toMatchObject({ outcome: 'SPLIT', note: 'Half the work was poor' });

    const money = await h.appOk('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.refunds.reduce((s: number, r: { amount: number }) => s + r.amount, 0)).toBe(80_000);
    const detail = await h.staffOk('GET', `/jobs/${id}`);
    expect(detail.money.heldInEscrow).toBe(0);

    const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, id));
    expect(events.at(-1)?.metadata).toMatchObject({ reason: 'Half the work was poor', resolution: 'SPLIT' });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'dispute.resolve'));
    expect(entry).toMatchObject({ targetId: id, reason: 'Half the work was poor' });
    const [reliability] = await db.select().from(reliabilityEvents).where(eq(reliabilityEvents.jobId, id));
    expect(reliability.type).toBe('dispute_split');
  });

  it('upholds the mechanic’s work, or sends them back to fix it', async () => {
    const uphold = await disputed();
    expect(
      (await h.staffOk('POST', `/jobs/${uphold}/resolve-dispute`, { outcome: 'UPHOLD_PROVIDER', reason: 'Photos show it was fine' }))
        .status,
    ).toBe('COMPLETED');
    expect((await h.staffOk('GET', `/jobs/${uphold}`)).money.heldInEscrow).toBe(0);

    // Brian is free again for the next job.
    const rework = await disputed();
    expect(
      (await h.staffOk('POST', `/jobs/${rework}/resolve-dispute`, { outcome: 'REWORK', reason: 'Gasket not seated' })).status,
    ).toBe('IN_PROGRESS');
  });

  it('refuses to resolve a job that is not disputed', async () => {
    const id = await finishedService();
    const res = await h.staff('POST', `/jobs/${id}/resolve-dispute`, { outcome: 'REWORK', reason: 'Testing this' });
    expect(res.statusCode).toBe(409);
  });
});

describe('customer care: stepping in on a job', () => {
  it('cancels a job and refunds what is held', async () => {
    const id = await h.arrived(REPAIR);
    const job = await h.staffOk('POST', `/jobs/${id}/cancel`, { reason: 'Mechanic stopped answering' });
    expect(job).toMatchObject({ status: 'CANCELLED', cancellation: { by: 'SYSTEM', reason: 'support_cancelled' } });
    const money = await h.appOk('GET', `/jobs/${id}/money`, WANJIRU);
    expect(money.refunds).toMatchObject([{ amount: 80_000 }]);
  });

  it('sends finished work to the dispute process instead of cancelling', async () => {
    const id = await finishedService();
    const res = await h.staff('POST', `/jobs/${id}/cancel`, { reason: 'Customer phoned in' });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/dispute/);
  });

  it('reassigns a mechanic who is not coming', async () => {
    await h.appOk('PUT', '/provider/availability', BRIAN, { online: true, location: REPAIR.location.coords });
    const job = await h.appOk('POST', '/jobs', WANJIRU, (await import('./fixtures')).booking(REPAIR));
    await h.pay(job.id);
    await h.appOk('POST', `/jobs/${job.id}/accept`, BRIAN);
    const moved = await h.staffOk('POST', `/jobs/${job.id}/reassign`, { reason: 'Brian is stuck in traffic' });
    expect(moved.providerId).toBeUndefined();
    expect(moved.reassignment).toMatchObject({ providerId: 'p1', note: 'Brian is stuck in traffic' });
    expect(['SEARCHING', 'OFFERED', 'CANCELLED']).toContain(moved.status);
  });

  it('needs a reason, and the right permission', async () => {
    const id = await h.arrived(REPAIR);
    expect((await h.staff('POST', `/jobs/${id}/cancel`, { reason: '' })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'POST', url: `/admin/jobs/${id}/cancel`, payload: { reason: 'No session' } })).statusCode).toBe(403);
  });
});

describe('customer care: notes and customers', () => {
  it('keeps notes on a job and on a person', async () => {
    const id = await h.arrived(REPAIR);
    await h.staffOk('POST', '/notes', { targetType: 'job', targetId: id, body: 'Called her: she is at the gate.' });
    await h.staffOk('POST', '/notes', { targetType: 'user', targetId: 'wanjiru', body: 'Prefers calls after 5pm.' });
    expect(await h.staffOk('GET', `/notes?targetType=job&targetId=${id}`)).toMatchObject([
      { body: 'Called her: she is at the gate.', staffEmail: 'owner@example.com' },
    ]);
    expect((await h.staff('POST', '/notes', { targetType: 'job', targetId: id, body: '   ' })).statusCode).toBe(400);
    expect((await h.staff('POST', '/notes', { targetType: 'job', targetId: 'job_nope', body: 'Hello' })).statusCode).toBe(404);
  });

  it('finds customers and shows one with their jobs and money', async () => {
    const id = await h.arrived(REPAIR);
    const list = await h.staffOk('GET', '/customers?q=0700000001');
    expect(list).toMatchObject([{ id: 'wanjiru', jobs: 1, openJobs: 1 }]);
    const detail = await h.staffOk('GET', '/users/wanjiru');
    expect(detail.user).toMatchObject({ name: 'Wanjiru', role: 'CUSTOMER', status: 'ACTIVE' });
    expect(detail.jobs.map((j: { id: string }) => j.id)).toEqual([id]);
    expect(detail.money).toEqual({ paid: 80_000, refunded: 0 });
  });

  it('suspends and restores an account', async () => {
    await h.staffOk('POST', '/users/otieno/suspend', { reason: 'Abusive to mechanics' });
    const refused = await h.app.inject({ url: '/jobs', headers: OTIENO });
    expect(refused.statusCode).toBe(403);
    expect((await h.staff('POST', '/users/otieno/suspend', { reason: 'Again please' })).statusCode).toBe(409);
    await h.staffOk('POST', '/users/otieno/unsuspend', { reason: 'Apologised, first warning' });
    expect((await h.app.inject({ url: '/jobs', headers: OTIENO })).statusCode).toBe(200);
  });

  it('takes a suspended mechanic offline', async () => {
    await h.appOk('PUT', '/provider/availability', BRIAN, { online: true, location: REPAIR.location.coords });
    await h.staffOk('POST', '/users/p1/suspend', { reason: 'Customer complaints' });
    const [p] = await db.select().from(providers).where(eq(providers.userId, 'p1'));
    expect(p.online).toBe(false);
  });
});

describe('mechanics: verification', () => {
  async function newMechanic() {
    const at = new Date();
    await db.insert(users).values({ id: 'p2', phone: '254712000202', name: 'Achieng', role: 'PROVIDER', status: 'ACTIVE', createdAt: at, updatedAt: at });
    await db.insert(providers).values({
      userId: 'p2',
      type: 'garage',
      businessName: 'Achieng Motors',
      specialty: 'Service',
      payoutPhone: '254712000202',
      verification: 'PENDING',
      createdAt: at,
      updatedAt: at,
    });
  }
  const ACHIENG = { 'x-dev-user': 'provider:p2' };

  it('lists waiting mechanics first, and verifying lets them go online', async () => {
    await newMechanic();
    const list = await h.staffOk('GET', '/mechanics');
    expect(list.map((m: { id: string }) => m.id)).toEqual(['p2', 'p1']);
    expect((await h.staffOk('GET', '/mechanics/pending-count')).count).toBe(1);

    const online = { online: true, location: REPAIR.location.coords };
    expect((await h.app.inject({ method: 'PUT', url: '/provider/availability', headers: ACHIENG, payload: online })).statusCode).toBe(409);
    await h.staffOk('POST', '/mechanics/p2/verify', { reason: 'ID and garage permit checked' });
    await h.appOk('PUT', '/provider/availability', ACHIENG, online);
    expect((await h.staff('POST', '/mechanics/p2/verify', { reason: 'Twice by mistake' })).statusCode).toBe(409);
  });

  it('rejects with a reason the mechanic sees, and a fixed profile goes back in the queue', async () => {
    await newMechanic();
    await h.staffOk('POST', '/mechanics/p2/reject', { reason: 'Please add your garage business permit' });
    const me = await h.appOk('GET', '/me', ACHIENG);
    expect(me.provider).toMatchObject({ verification: 'REJECTED', verificationNote: 'Please add your garage business permit' });

    await h.appOk('PUT', '/me/provider', ACHIENG, { type: 'garage', businessName: 'Achieng Motors Ltd', specialty: 'Service' });
    expect((await h.appOk('GET', '/me', ACHIENG)).provider.verification).toBe('PENDING');
  });

  it('shows a mechanic’s record', async () => {
    await finishedService();
    const record = await h.staffOk('GET', '/mechanics/p1/record');
    expect(record.payouts).toHaveLength(1); // the parts, paid out at once
    expect(record.reliability.days).toBe(30);
  });
});

describe('finance', () => {
  it('adds up money in, earnings by kind, and what is held', async () => {
    const id = await finishedService();
    await h.appOk('POST', `/jobs/${id}/confirm`, WANJIRU);
    const summary = await h.staffOk('GET', '/finance/summary');
    expect(summary.moneyIn).toEqual(
      expect.arrayContaining([
        { purpose: 'CALL_OUT', count: 1, amount: 80_000, parts: 0 },
        { purpose: 'SERVICE', count: 1, amount: 570_000, parts: 490_000 },
      ]),
    );
    const earned = Object.fromEntries(
      summary.earnings.map((e: { purpose: string; commission: number }) => [e.purpose, e.commission]),
    );
    expect(earned).toEqual({ CALL_OUT: 16_000, SERVICE: 16_000, PARTS: 24_500 });
    expect(summary.now.heldInEscrow).toEqual({ amount: 0, jobs: 0 });
    expect(summary.byDay).toHaveLength(30);
    expect(summary.byDay.at(-1)).toMatchObject({ moneyIn: 650_000, commission: 56_500 });

    expect(await h.staffOk('GET', '/finance/transactions?type=release')).toHaveLength(2);
    expect(await h.staffOk('GET', '/finance/providers')).toMatchObject([{ id: 'p1', payouts: 2, net: 650_000 - 56_500 }]);
  });

  it('lists jobs with money still held', async () => {
    const id = await h.arrived(REPAIR);
    expect(await h.staffOk('GET', '/finance/escrow')).toMatchObject([{ id, heldInEscrow: 80_000 }]);
  });
});

describe('engineering and the dashboard', () => {
  it('shows recent requests, errors, timers and the system', async () => {
    await h.app.inject({ url: '/jobs/job_missing', headers: WANJIRU });
    const { requests, totals } = await h.staffOk('GET', '/requests?filter=errors');
    expect(requests[0]).toMatchObject({ method: 'GET', route: '/jobs/:id', status: 404, who: 'customer:wanjiru' });
    expect(totals.errors).toBeGreaterThan(0);

    await h.arrived(REPAIR);
    expect((await h.staffOk('GET', '/timers')).length).toBeGreaterThan(0);

    const system = await h.staffOk('GET', '/system');
    expect(system.features).toMatchObject({ adminDevSignIn: true, simulatedMpesa: true });
    expect(system.database.tables.map((t: { table: string }) => t.table)).toContain('jobs');
  });

  it('puts disputes, waiting mechanics and money on the dashboard', async () => {
    await disputed();
    const dash = await h.staffOk('GET', '/dashboard');
    expect(dash.jobs.openDisputes).toBe(1);
    expect(dash.mechanics).toEqual({ awaitingVerification: 0 });
    expect(dash.money.heldInEscrow).toBe(160_000);
  });
});
