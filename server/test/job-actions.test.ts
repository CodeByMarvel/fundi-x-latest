import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_CONFIRM_MS,
  NO_SHOW_WAIT_MS,
  SERVICE_PAYMENT_WINDOW_MS,
} from '../../src/domain/jobs/rules';
import { line } from '../../src/domain/quotes/quotes';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import {
  charges,
  jobs,
  payments,
  providers,
  releases,
  reliabilityEvents,
  users,
} from '../src/db/schema';
import { newId } from '../src/ids';
import { moveJob } from '../src/jobs/service';
import { lockJob } from '../src/jobs/store';
import { matchingCell } from '../src/matching/h3';
import { callOutPaid } from '../src/matching/service';
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
  // Brian (p1) is online, right next to the customer.
  await post('/provider/availability', BRIAN, { online: true, location: HOME }, 'PUT');
});
afterAll(async () => {
  await app.close();
  await close();
});

const HOME = REPAIR.location.coords!;
const GRACE = { 'x-dev-user': 'provider:p2' };

type Headers = Record<string, string>;

async function post(url: string, headers: Headers, payload?: object, method: 'POST' | 'PUT' = 'POST') {
  return app.inject({ method, url, headers, ...(payload && { payload }) });
}

/** An action that must succeed; returns its JSON. */
async function ok(url: string, headers: Headers, payload?: object) {
  const res = await post(url, headers, payload);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

/** An action that must fail with `error`. */
async function refused(url: string, headers: Headers, error: string, payload?: object) {
  const res = await post(url, headers, payload);
  expect(res.json().error, res.body).toBe(error);
}

/** M-Pesa stand-in: money for `purpose` reached escrow. */
async function paid(jobId: string, purpose: 'CALL_OUT' | 'SERVICE', amount: number) {
  const at = new Date();
  await db.insert(payments).values({
    id: newId('pay'),
    jobId,
    purpose,
    method: 'MPESA',
    phone: '254700000001',
    amount,
    status: 'SUCCESS',
    receiptNumber: 'SXX0000000',
    createdAt: at,
    updatedAt: at,
  });
  return db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    return purpose === 'CALL_OUT'
      ? callOutPaid(tx, job, at)
      : moveJob(tx, job, 'IN_PROGRESS', 'SYSTEM', at);
  });
}

/** Booked, call-out paid, offered to Brian. */
async function offered(details = REPAIR) {
  const res = await post('/jobs', WANJIRU, booking(details));
  expect(res.statusCode).toBe(201);
  const job = await paid(res.json().id, 'CALL_OUT', 80_000);
  expect(job.offeredProviderId).toBe('p1');
  return job;
}

/** Brian has accepted, driven over and arrived. */
async function arrived(details = REPAIR) {
  const { id } = await offered(details);
  await ok(`/jobs/${id}/accept`, BRIAN);
  await ok(`/jobs/${id}/start-trip`, BRIAN);
  return ok(`/jobs/${id}/arrived`, BRIAN);
}

const ITEMS = [line('BRAKE_PAD_FRONT', 4500), line('LABOUR_BRAKE_PADS', 2000)];
const EXTRA = [line('BRAKE_DISC_FRONT', 6000)];

const row = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

async function addProvider(id: string) {
  const at = new Date();
  await db.insert(users).values({ id, name: id, role: 'PROVIDER', status: 'ACTIVE', createdAt: at, updatedAt: at });
  await db.insert(providers).values({
    userId: id,
    type: 'mechanic',
    specialty: 'Brakes',
    payoutPhone: '254799000000',
    verification: 'VERIFIED',
    online: true,
    lat: HOME.lat,
    lng: HOME.lng,
    h3Cell: matchingCell(HOME),
    locationAt: at,
    createdAt: at,
    updatedAt: at,
  });
}

describe('a repair from offer to rating', () => {
  it('runs the whole QUOTED flow, and the money adds up', async () => {
    const { id } = await offered();
    const accepted = await ok(`/jobs/${id}/accept`, BRIAN);
    expect(accepted).toMatchObject({ status: 'ACCEPTED', providerId: 'p1' });

    const trip = await ok(`/jobs/${id}/start-trip`, BRIAN);
    expect(trip.status).toBe('EN_ROUTE');
    expect(trip.etaMinutes).toBe(5); // same spot: the minimum
    expect(Date.parse(trip.expectedArrivalAt)).toBeGreaterThan(Date.now());

    await ok(`/jobs/${id}/arrived`, BRIAN);
    await ok(`/jobs/${id}/start-inspection`, BRIAN);
    const quote = await ok(`/jobs/${id}/quote`, BRIAN, { items: ITEMS, note: 'Pads worn' });
    expect(quote).toMatchObject({ kind: 'BASE', version: 1, status: 'PENDING', total: 650_000 });

    const approved = await ok(`/jobs/${id}/approve-quote`, WANJIRU, { quoteId: quote.id });
    expect(approved.status).toBe('SERVICE_PAYMENT_PENDING');
    const serviceCharge = await db
      .select()
      .from(charges)
      .where(and(eq(charges.jobId, id), eq(charges.purpose, 'SERVICE')));
    expect(serviceCharge.map(c => c.amount)).toEqual([650_000]);

    await paid(id, 'SERVICE', 650_000);
    // Extra work found: finishing waits for the customer's answer.
    const extra = await ok(`/jobs/${id}/additional-quote`, BRIAN, {
      items: EXTRA,
      reason: 'Discs scored',
    });
    await refused(`/jobs/${id}/complete`, BRIAN, 'additional_quote_pending');
    // Extra work is approved by paying, not by a button.
    await refused(`/jobs/${id}/approve-quote`, WANJIRU, 'pay_to_approve', { quoteId: extra.id });
    const afterNo = await ok(`/jobs/${id}/reject-quote`, WANJIRU, { quoteId: extra.id });
    expect(afterNo.status).toBe('IN_PROGRESS');

    await ok(`/jobs/${id}/complete`, BRIAN, { summary: 'Replaced front pads' });
    const done = await ok(`/jobs/${id}/confirm`, WANJIRU);
    expect(done.status).toBe('COMPLETED');

    // Call-out and service released to Brian, less 20% commission on the service.
    const [release] = await db.select().from(releases).where(eq(releases.jobId, id));
    expect(release.gross).toBe(80_000 + 650_000);
    expect(release.providerId).toBe('p1');

    const rated = await ok(`/jobs/${id}/rate`, WANJIRU, { stars: 5, comment: 'Quick' });
    expect(rated.rating).toMatchObject({ stars: 5, comment: 'Quick' });
    await refused(`/jobs/${id}/rate`, WANJIRU, 'cannot_rate', { stars: 4 });
    const [brian] = await db.select().from(providers).where(eq(providers.userId, 'p1'));
    expect([brian.ratingTotal, brian.ratingCount]).toEqual([5, 1]);

    const quotes = (await app.inject({ url: `/jobs/${id}/quotes`, headers: WANJIRU })).json();
    expect(quotes.map((q: { kind: string; status: string }) => `${q.kind}:${q.status}`)).toEqual([
      'BASE:APPROVED',
      'ADDITIONAL:REJECTED',
    ]);
  });

  it('lists each side its own jobs', async () => {
    const { id } = await offered();
    const mine = (await app.inject({ url: '/jobs', headers: WANJIRU })).json();
    const brians = (await app.inject({ url: '/jobs', headers: BRIAN })).json();
    const otienos = (await app.inject({ url: '/jobs', headers: OTIENO })).json();
    expect(mine.map((j: { id: string }) => j.id)).toEqual([id]);
    expect(brians.map((j: { id: string }) => j.id)).toEqual([id]);
    expect(otienos).toEqual([]);
  });
});

describe('quotes', () => {
  it('a revised quote makes the old one stale', async () => {
    const { id } = await arrived();
    await ok(`/jobs/${id}/start-inspection`, BRIAN);
    const first = await ok(`/jobs/${id}/quote`, BRIAN, { items: ITEMS });
    await ok(`/jobs/${id}/revise-quote`, BRIAN);
    const second = await ok(`/jobs/${id}/quote`, BRIAN, { items: [ITEMS[0]] });
    expect(second.version).toBe(2);
    await refused(`/jobs/${id}/approve-quote`, WANJIRU, 'stale_quote', { quoteId: first.id });
    await ok(`/jobs/${id}/approve-quote`, WANJIRU, { quoteId: second.id });
  });

  it('declining the main quote ends the job; the call-out paid for the visit', async () => {
    const { id } = await arrived();
    await ok(`/jobs/${id}/start-inspection`, BRIAN);
    const quote = await ok(`/jobs/${id}/quote`, BRIAN, { items: ITEMS });
    const job = await ok(`/jobs/${id}/reject-quote`, WANJIRU, { quoteId: quote.id });
    expect(job).toMatchObject({ status: 'CANCELLED', cancellation: { reason: 'quote_declined' } });
    const [release] = await db.select().from(releases).where(eq(releases.jobId, id));
    expect(release.gross).toBe(80_000);
  });

  it('refuses a quote with unknown codes or no items', async () => {
    const { id } = await arrived();
    await ok(`/jobs/${id}/start-inspection`, BRIAN);
    await refused(`/jobs/${id}/quote`, BRIAN, 'invalid_quote', {
      items: [{ ...ITEMS[0], serviceCode: 'MADE_UP' }],
    });
    await refused(`/jobs/${id}/quote`, BRIAN, 'invalid_request', { items: [] });
  });
});

describe('fixed-price service', () => {
  it('asks for payment on arrival and closes the job if it never comes', async () => {
    const { id } = await arrived(SERVICE);
    await refused(`/jobs/${id}/start-inspection`, BRIAN, 'job_transition');
    const due = await ok(`/jobs/${id}/ready-to-start`, BRIAN);
    expect(due.status).toBe('SERVICE_PAYMENT_PENDING');

    await runDueTimers(db, new Date(Date.now() + SERVICE_PAYMENT_WINDOW_MS + 1000));
    expect((await row(id)).extra.cancellation).toMatchObject({ by: 'SYSTEM', reason: 'service_unpaid' });
  });
});

describe('offers', () => {
  it('a decline is recorded and the next provider is asked straight away', async () => {
    const { id } = await offered();
    await addProvider('p2');
    const next = await ok(`/jobs/${id}/decline`, BRIAN);
    expect(next).toMatchObject({ status: 'OFFERED', offeredProviderId: 'p2' });
    const events = await db.select().from(reliabilityEvents).where(eq(reliabilityEvents.jobId, id));
    expect(events.map(e => e.type)).toEqual(['offer_declined']);
    // Brian can no longer act on it.
    await refused(`/jobs/${id}/accept`, BRIAN, 'not_found');
    await ok(`/jobs/${id}/accept`, GRACE);
  });

  it('an offer past its time can no longer be accepted', async () => {
    const { id } = await offered();
    const { extra } = await row(id);
    await db
      .update(jobs)
      .set({ extra: { ...extra, offerExpiresAt: new Date(Date.now() - 1000).toISOString() } })
      .where(eq(jobs.id, id));
    await refused(`/jobs/${id}/accept`, BRIAN, 'offer_expired');
  });

  it('withdrawing en route starts the search again without that provider', async () => {
    const { id } = await offered();
    await ok(`/jobs/${id}/accept`, BRIAN);
    await ok(`/jobs/${id}/start-trip`, BRIAN);
    await addProvider('p2');
    const job = await ok(`/jobs/${id}/withdraw`, BRIAN, { note: 'Flat tyre' });
    expect(job).toMatchObject({
      status: 'OFFERED',
      offeredProviderId: 'p2',
      reassignment: { providerId: 'p1', note: 'Flat tyre' },
    });
    expect(job.expectedArrivalAt).toBeUndefined();
    const events = await db.select().from(reliabilityEvents).where(eq(reliabilityEvents.jobId, id));
    expect(events.map(e => e.type)).toEqual(['withdrew_en_route']);
  });
});

describe('who may do what', () => {
  it("hides other people's jobs and refuses moves out of order", async () => {
    const { id } = await offered();
    await refused(`/jobs/${id}/accept`, WANJIRU, 'not_found'); // customers don't accept
    await refused(`/jobs/${id}/confirm`, OTIENO, 'not_found'); // not his job
    await ok(`/jobs/${id}/accept`, BRIAN);
    await refused(`/jobs/${id}/arrived`, BRIAN, 'job_transition'); // trip not started
    await refused(`/jobs/${id}/confirm`, WANJIRU, 'job_transition');
  });

  it('a no-show can only be reported after the 15-minute wait', async () => {
    const { id } = await arrived();
    await refused(`/jobs/${id}/no-show`, BRIAN, 'wait_longer');
    const extra = (await row(id)).extra;
    await db
      .update(jobs)
      .set({ extra: { ...extra, arrivedAt: new Date(Date.now() - NO_SHOW_WAIT_MS - 1000).toISOString() } })
      .where(eq(jobs.id, id));
    const job = await ok(`/jobs/${id}/no-show`, BRIAN);
    expect(job.cancellation).toMatchObject({ by: 'PROVIDER', reason: 'customer_no_show' });
  });
});

describe('after the work', () => {
  async function awaitingConfirmation() {
    const { id } = await arrived(SERVICE);
    await ok(`/jobs/${id}/ready-to-start`, BRIAN);
    const [due] = await db.select().from(charges).where(and(eq(charges.jobId, id), eq(charges.purpose, 'SERVICE')));
    await paid(id, 'SERVICE', due.amount);
    await ok(`/jobs/${id}/complete`, BRIAN);
    return id;
  }

  it('is confirmed automatically after 48 hours of silence', async () => {
    const id = await awaitingConfirmation();
    await runDueTimers(db, new Date(Date.now() + AUTO_CONFIRM_MS + 1000));
    const job = await row(id);
    expect(job.status).toBe('COMPLETED');
    expect(job.completedAt).not.toBeNull();
  });

  it('a dispute keeps the money in escrow and stops the auto-confirm', async () => {
    const id = await awaitingConfirmation();
    await refused(`/jobs/${id}/dispute`, WANJIRU, 'invalid_request', { reason: '' });
    const job = await ok(`/jobs/${id}/dispute`, WANJIRU, { reason: 'Still squeaks' });
    expect(job).toMatchObject({ status: 'DISPUTED', dispute: { reason: 'Still squeaks' } });
    await runDueTimers(db, new Date(Date.now() + AUTO_CONFIRM_MS + 1000));
    expect((await row(id)).status).toBe('DISPUTED');
    expect(await db.select().from(releases).where(eq(releases.jobId, id))).toEqual([]);
  });
});

describe('live ETA', () => {
  it('updates from position reports while en route', async () => {
    const { id } = await offered();
    await ok(`/jobs/${id}/accept`, BRIAN);
    await post('/provider/location', BRIAN, { lat: HOME.lat + 0.05, lng: HOME.lng }, 'PUT');
    const trip = await ok(`/jobs/${id}/start-trip`, BRIAN);
    expect(trip.etaMinutes).toBeGreaterThan(5); // ~5.5 km away
    const promised = trip.expectedArrivalAt;

    await post('/provider/location', BRIAN, { lat: HOME.lat + 0.01, lng: HOME.lng }, 'PUT');
    const job = (await app.inject({ url: `/jobs/${id}`, headers: WANJIRU })).json();
    expect(job.etaMinutes).toBeLessThan(trip.etaMinutes);
    // The promise the late rule uses doesn't move.
    expect(job.expectedArrivalAt).toBe(promised);
  });
});
