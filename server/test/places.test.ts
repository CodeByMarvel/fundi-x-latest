import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Coordinates } from '../../src/domain/jobs/request';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { providers, savedPlaces, users } from '../src/db/schema';
import { matchingCell } from '../src/matching/h3';
import { BRIAN, OTIENO, REPAIR, resetTables, WANJIRU, WORKS_EVERYWHERE } from './fixtures';

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

const HOME = REPAIR.location.coords!;
const north = (km: number): Coordinates => ({ lat: HOME.lat + km / 111, lng: HOME.lng });

const savePlace = (headers: Record<string, string>, kind: string, payload: object) =>
  app.inject({ method: 'PUT', url: `/me/places/${kind}`, headers, payload });
const places = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/me/places', headers });

describe('saved places', () => {
  it('saves, replaces and lists a customer’s own places', async () => {
    expect((await places(WANJIRU)).json()).toEqual([]);

    await savePlace(WANJIRU, 'home', { address: 'Kileleshwa', coords: HOME });
    const res = await savePlace(WANJIRU, 'home', { address: ' Lavington ', coords: north(1) });
    expect(res.statusCode).toBe(200);
    await savePlace(WANJIRU, 'work', { address: 'Westlands', coords: north(2) });

    const mine = (await places(WANJIRU)).json();
    expect(mine.map((p: { kind: string; address: string }) => [p.kind, p.address])).toEqual([
      ['home', 'Lavington'],
      ['work', 'Westlands'],
    ]);
    expect(mine[0].coords).toEqual(north(1));
    // Someone else's places are never visible.
    expect((await places(OTIENO)).json()).toEqual([]);
  });

  it('refuses unknown kinds, bad positions and mechanics', async () => {
    expect((await savePlace(WANJIRU, 'gym', { address: 'x', coords: HOME })).statusCode).toBe(400);
    expect(
      (await savePlace(WANJIRU, 'home', { address: 'x', coords: { lat: 200, lng: 0 } })).statusCode,
    ).toBe(400);
    expect((await savePlace(WANJIRU, 'home', { address: '', coords: HOME })).statusCode).toBe(400);
    expect((await places(BRIAN)).statusCode).toBe(403);
  });

  it('removes a place, and all of them with the account', async () => {
    await savePlace(WANJIRU, 'home', { address: 'Kileleshwa', coords: HOME });
    await savePlace(WANJIRU, 'work', { address: 'Westlands', coords: north(2) });

    const removed = await app.inject({ method: 'DELETE', url: '/me/places/work', headers: WANJIRU });
    expect(removed.statusCode).toBe(200);
    const again = await app.inject({ method: 'DELETE', url: '/me/places/work', headers: WANJIRU });
    expect(again.statusCode).toBe(404);

    await app.inject({ method: 'DELETE', url: '/me', headers: WANJIRU });
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, 'wanjiru'))).toEqual([]);
  });
});

describe('nearby mechanics', () => {
  async function online(id: string, where: Coordinates, extra: Partial<typeof providers.$inferInsert> = {}) {
    const at = new Date();
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
      ...WORKS_EVERYWHERE,
      payoutPhone: '254799000000',
      verification: 'VERIFIED',
      online: true,
      lat: where.lat,
      lng: where.lng,
      h3Cell: matchingCell(where),
      locationAt: at,
      createdAt: at,
      updatedAt: at,
      ...extra,
    });
  }

  const nearby = (where: Coordinates, headers = WANJIRU) =>
    app.inject({ method: 'GET', url: `/providers/nearby?lat=${where.lat}&lng=${where.lng}`, headers });

  it('lists available mechanics nearest first, without exact distance or phone', async () => {
    await online('far', north(3.2));
    await online('near', north(0.3));
    await online('offline', north(0.1), { online: false });
    await online('unverified', north(0.1), { verification: 'PENDING' });
    await online('stale', north(0.1), { locationAt: new Date(Date.now() - 60 * 60_000) });
    await online('away', north(40));

    const res = await nearby(HOME);
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((p: { id: string }) => p.id)).toEqual(['near', 'far']);
    expect(list[0]).toMatchObject({ distanceKm: 0.5, phone: '', online: true });
    expect(list[1].distanceKm).toBe(3.5);
  });

  it('is for customers only', async () => {
    expect((await nearby(HOME, BRIAN)).statusCode).toBe(403);
    const bad = await app.inject({ method: 'GET', url: '/providers/nearby?lat=1', headers: WANJIRU });
    expect(bad.statusCode).toBe(400);
  });
});
