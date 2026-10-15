import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Coordinates } from '../../src/domain/jobs/request';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import {
  jobEvents,
  jobMatching,
  jobs,
  providers,
  reliabilityEvents,
  timers,
  users,
} from '../src/db/schema';
import { lockJob } from '../src/jobs/store';
import { matchingCell, ringsApart, zoneCell } from '../src/matching/h3';
import { callOutPaid, PROVIDER_LOCATION_MAX_AGE_MS } from '../src/matching/service';
import { setSetting } from '../src/settings';
import { runDueTimers } from '../src/timers/worker';
import { BRIAN, booking, REPAIR, resetTables, WANJIRU } from './fixtures';

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

const SECOND = 1000;
const HOME = REPAIR.location.coords!;

/** A point `km` north of the customer's home (1° latitude ≈ 111 km). */
const north = (km: number): Coordinates => ({ lat: HOME.lat + km / 111, lng: HOME.lng });

/** A verified provider, online at `where` since `at`. */
async function provider(
  id: string,
  where: Coordinates,
  { at = new Date(), online = true, verification = 'VERIFIED' as const } = {},
) {
  await db.insert(users).values({
    id,
    phone: null,
    name: id,
    role: 'PROVIDER',
    status: 'ACTIVE',
    createdAt: at,
    updatedAt: at,
  });
  await db.insert(providers).values({
    userId: id,
    type: 'mechanic',
    specialty: 'Brakes',
    payoutPhone: '254799000000',
    verification,
    online,
    lat: where.lat,
    lng: where.lng,
    h3Cell: matchingCell(where),
    locationAt: at,
    createdAt: at,
    updatedAt: at,
  });
}

async function book(details = REPAIR) {
  const res = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers: WANJIRU,
    payload: booking(details),
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** Books a job and pretends M-Pesa confirmed the call-out at `at`. */
async function paidJob(at = new Date()) {
  const { id } = await book();
  return db.transaction(async tx => callOutPaid(tx, await lockJob(tx, id), at));
}

const jobRow = async (id: string) =>
  (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

const offersOf = async (jobId: string) =>
  (
    await db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, jobId), eq(jobEvents.toStatus, 'OFFERED')))
  ).map(e => e.metadata);

/** Runs the timer worker at each moment in turn, like the clock moving on. */
async function runAt(...moments: Date[]) {
  for (const m of moments) {
    await runDueTimers(db, m);
  }
}

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe('H3 cells', () => {
  it('puts neighbouring points into rings about 0.9 km apart', () => {
    const home = matchingCell(HOME);
    expect(ringsApart(home, matchingCell(HOME))).toBe(0);
    // Exact rings depend on where the hexagon edges fall, hence the ranges.
    expect(ringsApart(home, matchingCell(north(1)))).toBeGreaterThanOrEqual(1);
    expect(ringsApart(home, matchingCell(north(1)))).toBeLessThanOrEqual(2);
    expect(ringsApart(home, matchingCell(north(4.5)))).toBeGreaterThanOrEqual(4);
    expect(ringsApart(home, matchingCell(north(4.5)))).toBeLessThanOrEqual(6);
  });

  it('stores the cell and the coarse zone with the booking', async () => {
    const job = await book();
    const row = await jobRow(job.id);
    expect(row.h3Cell).toBe(matchingCell(HOME));
    expect(row.locationZone).toBe(zoneCell(HOME));
    expect(job.location.coords).toEqual(HOME);
  });

  it('refuses a booking without coordinates', async () => {
    const { coords: _, ...noCoords } = REPAIR.location;
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: WANJIRU,
      payload: booking({ ...REPAIR, location: noCoords }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('provider availability', () => {
  const put = (url: string, payload: object) =>
    app.inject({ method: 'PUT', url, headers: BRIAN, payload });

  it('needs a position to go online, and forgets it when going offline', async () => {
    expect((await put('/provider/availability', { online: true })).json().error).toBe(
      'location_required',
    );
    const on = await put('/provider/availability', { online: true, location: north(1) });
    expect(on.json()).toMatchObject({ online: true, verification: 'VERIFIED' });
    expect((await db.select().from(providers).where(eq(providers.userId, 'p1')))[0].h3Cell).toBe(
      matchingCell(north(1)),
    );

    await put('/provider/availability', { online: false });
    const [row] = await db.select().from(providers).where(eq(providers.userId, 'p1'));
    expect(row).toMatchObject({ online: false, lat: null, h3Cell: null, locationAt: null });
    // Offline: we don't take positions at all.
    expect((await put('/provider/location', north(2))).json().error).toBe('offline');
  });

  it('keeps unverified providers offline', async () => {
    await db.update(providers).set({ verification: 'PENDING' }).where(eq(providers.userId, 'p1'));
    const res = await put('/provider/availability', { online: true, location: north(1) });
    expect(res.json().error).toBe('not_verified');
  });

  it('refuses customers', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/provider/location',
      headers: WANJIRU,
      payload: north(1),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('matching', () => {
  it('offers the job to the nearest free provider at once', async () => {
    await provider('far', north(2));
    await provider('near', HOME);
    const job = await paidJob();
    expect(job).toMatchObject({ status: 'OFFERED', offeredProviderId: 'near' });
    expect(await offersOf(job.id)).toEqual([{ providerId: 'near', ring: 0 }]);
    // The offer lapses on its own if nobody answers.
    const [expiry] = await db
      .select()
      .from(timers)
      .where(and(eq(timers.jobId, job.id), eq(timers.kind, 'OFFER_EXPIRY')));
    expect(expiry.dueAt.toISOString()).toBe(job.offerExpiresAt);
  });

  it('widens the search one ring per round until someone is in reach', async () => {
    const spot = north(2.8);
    const ring = ringsApart(matchingCell(HOME), matchingCell(spot));
    expect(ring).toBeGreaterThanOrEqual(3);
    await provider('rings-out', spot);
    const paidAt = new Date();
    const job = await paidJob(paidAt);
    expect(job.status).toBe('SEARCHING');

    // Rounds every 10 s: the rings before the provider's find nobody…
    const rounds = Array.from({ length: ring - 1 }, (_, i) => plus(paidAt, (i + 1) * 10 * SECOND));
    await runAt(...rounds);
    expect((await jobRow(job.id)).status).toBe('SEARCHING');
    // …their ring does.
    await runAt(plus(paidAt, ring * 10 * SECOND));
    expect((await jobRow(job.id)).offeredProviderId).toBe('rings-out');
    expect(await offersOf(job.id)).toEqual([{ providerId: 'rings-out', ring }]);
  });

  it('never sends anyone beyond the max ring: cancels and refunds instead', async () => {
    await provider('too-far', north(8));
    const paidAt = new Date();
    const job = await paidJob(paidAt);
    // Rings 1–5, one round each, then give up.
    await runAt(...[1, 2, 3, 4, 5].map(n => plus(paidAt, n * 10 * SECOND)));
    const row = await jobRow(job.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.extra.cancellation).toMatchObject({
      by: 'SYSTEM',
      reason: 'no_provider_available',
    });
    expect(await offersOf(job.id)).toEqual([]);
    expect((await db.select().from(jobMatching).where(eq(jobMatching.jobId, job.id)))[0].ring).toBe(5);
  });

  it('respects a max ring changed in settings', async () => {
    await setSetting(db, 'matching_max_ring', 1, null);
    await provider('two-rings-out', north(1.9));
    const paidAt = new Date();
    const job = await paidJob(paidAt);
    await runAt(plus(paidAt, 10 * SECOND));
    expect((await jobRow(job.id)).status).toBe('CANCELLED');
  });

  it('skips providers who are offline, unverified, busy, or whose position is stale', async () => {
    const now = new Date();
    await provider('offline', HOME, { online: false });
    await provider('unverified', HOME, { verification: 'PENDING' as never });
    await provider('stale', HOME, {
      at: new Date(now.getTime() - PROVIDER_LOCATION_MAX_AGE_MS - SECOND),
    });
    await provider('a', HOME);
    await provider('b', HOME);

    const first = await paidJob(now);
    // The first offer makes one of them busy, so the second job gets the other.
    const second = await paidJob(now);
    const third = await paidJob(now);
    expect([first.offeredProviderId, second.offeredProviderId].sort()).toEqual(['a', 'b']);
    expect(third.status).toBe('SEARCHING');
  });

  it('moves on when an offer expires, records it, and never asks the same provider twice', async () => {
    await provider('nearest', HOME);
    await provider('next', north(1.5));
    const paidAt = new Date();
    const job = await paidJob(paidAt);
    expect(job.offeredProviderId).toBe('nearest');

    // Expires at 45 s; the search carries on from ring 0 and widens until
    // it reaches "next".
    const ring = ringsApart(matchingCell(HOME), matchingCell(north(1.5)));
    await runAt(
      plus(paidAt, 45 * SECOND),
      ...Array.from({ length: ring }, (_, i) => plus(paidAt, (55 + i * 10) * SECOND)),
    );
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'OFFERED', offeredProviderId: 'next' });
    const events = await db
      .select()
      .from(reliabilityEvents)
      .where(eq(reliabilityEvents.jobId, job.id));
    expect(events.map(e => [e.providerId, e.type])).toEqual([['nearest', 'offer_expired']]);

    // "next" doesn't answer either. "nearest" is free again but was asked.
    await runAt(plus(paidAt, (45 + ring * 10 + 45) * SECOND));
    expect((await jobRow(job.id)).status).toBe('SEARCHING');
    expect((await offersOf(job.id)).map(o => o?.providerId)).toEqual(['nearest', 'next']);
  });

  it('prefers the more reliable of two providers in the same ring', async () => {
    await provider('unreliable', HOME);
    await provider('reliable', HOME);
    const old = await paidJob();
    await db.insert(reliabilityEvents).values({
      id: 'r1',
      providerId: 'unreliable',
      jobId: old.id,
      type: 'withdrew_en_route',
      createdAt: new Date(),
    });
    // Free both again for the real test.
    await db.update(jobs).set({ status: 'CANCELLED', offeredProviderId: null }).where(eq(jobs.id, old.id));

    const job = await paidJob();
    expect(job.offeredProviderId).toBe('reliable');
  });

  it('does nothing once the customer has cancelled the search', async () => {
    await provider('far', north(2.8));
    const paidAt = new Date();
    const job = await paidJob(paidAt);
    const cancel = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/cancel`,
      headers: WANJIRU,
    });
    expect(cancel.json().status).toBe('CANCELLED');
    await runAt(...[1, 2, 3, 4].map(n => plus(paidAt, n * 10 * SECOND)));
    expect(await offersOf(job.id)).toEqual([]);
  });

  it('never offers one provider two jobs at once', async () => {
    await provider('only-one', north(0.1));
    const [a, b] = await Promise.all([paidJob(), paidJob()]);
    const offered = [a, b].filter(j => j.status === 'OFFERED');
    expect(offered).toHaveLength(1);
  });
});
