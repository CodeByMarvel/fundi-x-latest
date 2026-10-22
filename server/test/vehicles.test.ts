import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { normaliseRegistration } from '../src/accounts/vehicles';
import { createDatabase, type Database } from '../src/db/client';
import { BRIAN, OTIENO, resetTables, WANJIRU } from './fixtures';

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

type Headers = Record<string, string>;
const add = (headers: Headers, payload: object) =>
  app.inject({ method: 'POST', url: '/me/vehicles', headers, payload });
const list = async (headers: Headers) =>
  (await app.inject({ method: 'GET', url: '/me/vehicles', headers })).json();

const FIELDER = { registration: 'kda  123a', make: 'Toyota', model: 'Fielder', year: 2015 };

describe('my vehicles', () => {
  it('tidies the plate', () => {
    expect(normaliseRegistration(' kda  123a ')).toEqual({
      registration: 'KDA 123A',
      registrationKey: 'KDA123A',
    });
  });

  it('adds, lists and edits a customer’s own vehicles', async () => {
    const res = await add(WANJIRU, FIELDER);
    expect(res.statusCode).toBe(201);
    const fielder = res.json();
    expect(fielder).toEqual({
      id: expect.stringMatching(/^veh_/),
      registration: 'KDA 123A',
      make: 'Toyota',
      model: 'Fielder',
      year: 2015,
    });
    await add(WANJIRU, { registration: 'KXX 456B', make: 'Mercedes-Benz', model: 'C200' });

    const mine = await list(WANJIRU);
    expect(mine.map((v: { registration: string }) => v.registration)).toEqual(['KXX 456B', 'KDA 123A']);
    expect(await list(OTIENO)).toEqual([]);

    const edited = await app.inject({
      method: 'PUT',
      url: `/me/vehicles/${fielder.id}`,
      headers: WANJIRU,
      payload: { ...FIELDER, engineCc: 1500, fuel: 'petrol' },
    });
    expect(edited.json()).toMatchObject({ engineCc: 1500, fuel: 'petrol' });

    // Nobody else can change or remove it.
    const theirs = await app.inject({ method: 'DELETE', url: `/me/vehicles/${fielder.id}`, headers: OTIENO });
    expect(theirs.statusCode).toBe(404);
  });

  it('refuses the same car twice, however the plate is typed', async () => {
    await add(WANJIRU, FIELDER);
    const again = await add(WANJIRU, { ...FIELDER, registration: 'KDA123A' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'vehicle_exists', message: 'KDA123A is already in your vehicles' });
    // Another customer may have the same car (sold, or shared).
    expect((await add(OTIENO, FIELDER)).statusCode).toBe(201);
  });

  it('removes a vehicle, which can then be added again', async () => {
    const { id } = (await add(WANJIRU, FIELDER)).json();
    const removed = await app.inject({ method: 'DELETE', url: `/me/vehicles/${id}`, headers: WANJIRU });
    expect(removed.statusCode).toBe(200);
    expect(await list(WANJIRU)).toEqual([]);
    expect((await add(WANJIRU, FIELDER)).statusCode).toBe(201);
  });

  it('checks the details and who is asking', async () => {
    expect((await add(WANJIRU, { registration: 'KDA 123A', make: 'Toyota' })).statusCode).toBe(400);
    expect((await add(WANJIRU, { ...FIELDER, year: 1800 })).statusCode).toBe(400);
    expect((await add(WANJIRU, { ...FIELDER, registration: ' - ' })).statusCode).toBe(409);
    expect((await add(BRIAN, FIELDER)).statusCode).toBe(403);
  });

  it('goes with the account', async () => {
    await add(WANJIRU, FIELDER);
    await app.inject({ method: 'DELETE', url: '/me', headers: WANJIRU });
    expect(await list(OTIENO)).toEqual([]);
    const rows = await db.query.vehicles.findMany();
    expect(rows.every(v => v.removedAt !== null)).toBe(true);
  });
});
