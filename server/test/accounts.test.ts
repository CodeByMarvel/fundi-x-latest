import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kes } from '../../src/domain/money';
import { CALL_OUT_FEE } from '../../src/domain/pricing/engine';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { charges, users } from '../src/db/schema';
import { getSetting, setSetting } from '../src/settings';
import { booking, REPAIR, resetTables, SERVICE, WANJIRU } from './fixtures';

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

const estimate = (headers: Record<string, string>, details = REPAIR) =>
  app.inject({ method: 'POST', url: '/pricing/estimate', headers, payload: details });

describe('accounts', () => {
  it('refuses an account that does not exist', async () => {
    const res = await estimate({ 'x-dev-user': 'customer:nobody' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses an account used with the wrong role', async () => {
    // p1 is a provider account; claiming to be a customer doesn't work.
    const res = await estimate({ 'x-dev-user': 'customer:p1' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a suspended account on every request', async () => {
    await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, 'wanjiru'));
    const res = await estimate(WANJIRU);
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('This account is suspended');
  });
});

describe('settings: call-out fee', () => {
  it('uses the default until someone changes it', async () => {
    expect(await getSetting(db, 'call_out_fee')).toBe(CALL_OUT_FEE);
    expect((await estimate(WANJIRU)).json().callOut).toBe(CALL_OUT_FEE);
  });

  it('quotes and charges the changed fee, with no code change', async () => {
    const fee = kes(1000);
    await setSetting(db, 'call_out_fee', fee, null);

    expect((await estimate(WANJIRU, SERVICE)).json().callOut).toBe(fee);
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: WANJIRU,
      payload: booking(SERVICE, fee),
    });
    expect(res.statusCode).toBe(201);
    const [callOut] = await db
      .select()
      .from(charges)
      .where(eq(charges.purpose, 'CALL_OUT'));
    expect(callOut.amount).toBe(fee);
  });

  it('refuses a booking made at the old fee after a change', async () => {
    await setSetting(db, 'call_out_fee', kes(1000), null);
    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: WANJIRU,
      payload: booking(REPAIR, CALL_OUT_FEE),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('price_changed');
  });
});
