import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppleVerifier } from '../src/accounts/apple';
import { normalizeKenyanPhone } from '../src/accounts/phone';
import type { GoogleVerifier } from '../src/admin/google';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { appSessions, jobs, providers, users } from '../src/db/schema';
import { UnauthenticatedError } from '../src/errors';
import { booking, REPAIR, resetTables } from './fixtures';

/** Stands in for Google: "google:<account id>:<email>:<name>". */
const fakeGoogle: GoogleVerifier = async credential => {
  const [prefix, subject, email, name] = credential.split(':');
  if (prefix !== 'google' || !subject) {
    throw new UnauthenticatedError();
  }
  return { subject, email, name };
};
/** Stands in for Apple: "apple:<account id>:<email>". */
const fakeApple: AppleVerifier = async token => {
  const [prefix, subject, email] = token.split(':');
  if (prefix !== 'apple' || !subject) {
    throw new UnauthenticatedError();
  }
  return { subject, ...(email && { email }) };
};

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;

const build = (signInPerMinute = 1000) =>
  buildApp({
    db,
    allowDevHeader: false, // as in production
    accounts: {
      verifyGoogle: fakeGoogle,
      verifyApple: fakeApple,
      googleClientId: 'test-web-client',
      appleEnabled: true,
    },
    signInPerMinute,
  });

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = build();
});
beforeEach(() => resetTables(db));
afterAll(async () => {
  await app.close();
  await close();
});

const google = (credential: string, role: 'customer' | 'provider' = 'customer') =>
  app.inject({ method: 'POST', url: '/auth/google', payload: { credential, role } });

async function signedIn(credential = 'google:g-1:amina@gmail.com:Amina Odhiambo', role: 'customer' | 'provider' = 'customer') {
  const res = await google(credential, role);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { ...body, headers: { authorization: `Bearer ${body.token}` } };
}

const call = (method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, headers: object, payload?: object) =>
  app.inject({ method, url, headers: headers as Record<string, string>, ...(payload && { payload }) });

describe('signing in with Google', () => {
  it('tells the app which Google client to use', async () => {
    const res = await app.inject({ url: '/auth/config' });
    expect(res.json()).toEqual({ googleClientId: 'test-web-client', appleEnabled: true });
  });

  it('creates the account on first sign-in and asks for a phone number next', async () => {
    const { account, token } = await signedIn();
    expect(token).toBeTruthy();
    expect(account).toMatchObject({
      role: 'customer',
      name: 'Amina Odhiambo',
      email: 'amina@gmail.com',
      phone: null,
      nextStep: 'add_phone',
    });
  });

  it('finds the same account next time; a provider account is a separate one', async () => {
    const first = await signedIn();
    const again = await signedIn();
    expect(again.account.id).toBe(first.account.id);
    const asMechanic = await signedIn(undefined, 'provider');
    expect(asMechanic.account.id).not.toBe(first.account.id);
    expect(asMechanic.account.role).toBe('provider');
  });

  it('stores only a hash of the session token', async () => {
    const { token } = await signedIn();
    const [session] = await db.select().from(appSessions);
    expect(session.tokenHash).not.toBe(token);
    expect(session.method).toBe('google');
  });

  it('refuses a credential Google did not issue', async () => {
    expect((await google('forged')).statusCode).toBe(401);
  });

  it('refuses a suspended account', async () => {
    const { account } = await signedIn();
    await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, account.id));
    expect((await google('google:g-1:amina@gmail.com:Amina')).statusCode).toBe(403);
  });

  it('limits sign-in attempts from one address', async () => {
    const limited = build(3);
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const res = await limited.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { credential: 'forged', role: 'customer' },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429]);
    await limited.close();
  });
});

describe('signing in with Apple', () => {
  it('uses the name the app passes (Apple sends it only once)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { identityToken: 'apple:a-1:x7@privaterelay.appleid.com', role: 'customer', name: 'Otieno' },
    });
    expect(res.json().account).toMatchObject({ name: 'Otieno', email: 'x7@privaterelay.appleid.com' });
  });
});

describe('sessions', () => {
  it('work as a bearer token and end at sign-out', async () => {
    const { headers } = await signedIn();
    expect((await call('GET', '/me', headers)).statusCode).toBe(200);
    await call('POST', '/auth/sign-out', headers);
    expect((await call('GET', '/me', headers)).statusCode).toBe(401);
  });

  it('stop at once when the account is suspended', async () => {
    const { headers, account } = await signedIn();
    await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, account.id));
    expect((await call('GET', '/me', headers)).statusCode).toBe(403);
  });

  it('are required: a made-up token or a malformed header is refused', async () => {
    expect((await call('GET', '/me', { authorization: 'Bearer nope' })).statusCode).toBe(401);
    expect((await call('GET', '/me', { authorization: 'Basic abc' })).statusCode).toBe(401);
  });

  it('cannot be faked with the development header when it is switched off', async () => {
    const res = await call('GET', '/me', { 'x-dev-user': 'customer:wanjiru' });
    expect(res.statusCode).toBe(401);
  });
});

describe('phone number', () => {
  it('is saved in M-Pesa form, however it is typed', async () => {
    const { headers } = await signedIn();
    const res = await call('PUT', '/me/phone', headers, { phone: '0712 345 678' });
    expect(res.json()).toMatchObject({ phone: '254712345678', phoneVerified: false, nextStep: null });
  });

  it('rejects numbers that are not Kenyan mobiles', async () => {
    const { headers } = await signedIn();
    expect((await call('PUT', '/me/phone', headers, { phone: '12345' })).statusCode).toBe(400);
  });

  it('cannot be used by two accounts of the same kind', async () => {
    const a = await signedIn('google:g-1:a@x.com:A');
    const b = await signedIn('google:g-2:b@x.com:B');
    await call('PUT', '/me/phone', a.headers, { phone: '0712345678' });
    const res = await call('PUT', '/me/phone', b.headers, { phone: '+254712345678' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phone_in_use');
  });

  it('is needed before booking', async () => {
    const { headers } = await signedIn();
    const res = await call('POST', '/jobs', headers, booking(REPAIR));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phone_required');

    await call('PUT', '/me/phone', headers, { phone: '0712345678' });
    expect((await call('POST', '/jobs', headers, booking(REPAIR))).statusCode).toBe(201);
  });

  it('normalizes the usual ways of typing it', () => {
    expect(normalizeKenyanPhone('0712345678')).toBe('254712345678');
    expect(normalizeKenyanPhone('+254 712 345 678')).toBe('254712345678');
    expect(normalizeKenyanPhone('712345678')).toBe('254712345678');
    expect(normalizeKenyanPhone('0110 123 456')).toBe('254110123456');
    expect(normalizeKenyanPhone('0201234567')).toBeNull(); // a landline
    expect(normalizeKenyanPhone('07123')).toBeNull();
  });
});

const PROFILE = {
  type: 'mechanic',
  skills: ['electrical', 'brakes', 'diagnostics'],
  experienceYears: 6,
  transport: 'motorbike',
  base: { lat: -1.2921, lng: 36.7856 },
  baseDescription: '  Kilimani, near Yaya Centre ',
  travelKm: 10,
};

describe('mechanic profile', () => {
  it('needs the phone first, then waits for Fundi-X to verify it', async () => {
    const { headers } = await signedIn(undefined, 'provider');
    expect((await call('PUT', '/me/provider', headers, PROFILE)).json().error).toBe('phone_required');

    await call('PUT', '/me/phone', headers, { phone: '0722000111' });
    const res = await call('PUT', '/me/provider', headers, PROFILE);
    expect(res.json()).toMatchObject({
      nextStep: null,
      provider: {
        type: 'mechanic',
        // Skills in the catalogue's order; the summary is what customers see.
        skills: ['electrical', 'brakes', 'diagnostics'],
        specialty: 'Electrical, Brakes +1',
        experienceYears: 6,
        transport: 'motorbike',
        base: { lat: -1.2921, lng: 36.7856 },
        baseDescription: 'Kilimani, near Yaya Centre',
        travelKm: 10,
        verification: 'PENDING',
      },
    });
  });

  it('refuses unknown skills, no skills and odd travel limits', async () => {
    const { headers } = await signedIn(undefined, 'provider');
    await call('PUT', '/me/phone', headers, { phone: '0722000111' });
    for (const bad of [
      { skills: [] },
      { skills: ['flying'] },
      { skills: ['other_repair'] },
      { travelKm: 7 },
      { baseDescription: '   ' },
    ]) {
      expect((await call('PUT', '/me/provider', headers, { ...PROFILE, ...bad })).statusCode).toBe(400);
    }
  });

  it('asks mechanics from before profile v2 to finish it, and keeps them offline until then', async () => {
    const { headers, account } = await signedIn(undefined, 'provider');
    await call('PUT', '/me/phone', headers, { phone: '0722000111' });
    const at = new Date();
    await db.insert(providers).values({
      userId: account.id,
      type: 'mechanic',
      specialty: 'Brakes',
      payoutPhone: '254722000111',
      verification: 'VERIFIED',
      createdAt: at,
      updatedAt: at,
    });
    expect((await call('GET', '/me', headers)).json().nextStep).toBe('provider_profile');
    const online = await call('PUT', '/provider/availability', headers, {
      online: true,
      location: { lat: -1.2921, lng: 36.7856 },
    });
    expect(online.json().error).toBe('provider_profile');

    const res = await call('PUT', '/me/provider', headers, PROFILE);
    expect(res.json()).toMatchObject({ nextStep: null, provider: { verification: 'VERIFIED' } });
  });

  it('keeps the verification decision when the profile is edited', async () => {
    const { headers, account } = await signedIn(undefined, 'provider');
    await call('PUT', '/me/phone', headers, { phone: '0722000111' });
    await call('PUT', '/me/provider', headers, PROFILE);
    await db.update(providers).set({ verification: 'VERIFIED' }).where(eq(providers.userId, account.id));
    const res = await call('PUT', '/me/provider', headers, { ...PROFILE, type: 'garage', businessName: 'Kilimani Auto', travelKm: 15 });
    expect(res.json().provider).toMatchObject({ type: 'garage', travelKm: 15, verification: 'VERIFIED' });
  });

  it('is only for mechanic accounts', async () => {
    const { headers } = await signedIn();
    await call('PUT', '/me/phone', headers, { phone: '0712345678' });
    expect((await call('PUT', '/me/provider', headers, PROFILE)).statusCode).toBe(403);
  });
});

describe('deleting an account', () => {
  it('is refused while a job is open', async () => {
    const { headers } = await signedIn();
    await call('PUT', '/me/phone', headers, { phone: '0712345678' });
    await call('POST', '/jobs', headers, booking(REPAIR));
    const res = await call('DELETE', '/me', headers);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('active_jobs');
  });

  it('wipes personal details, ends sessions, keeps the job history', async () => {
    const { headers, account } = await signedIn();
    await call('PUT', '/me/phone', headers, { phone: '0712345678' });
    const job = (await call('POST', '/jobs', headers, booking(REPAIR))).json();
    await db.update(jobs).set({ status: 'CANCELLED' }).where(eq(jobs.id, job.id));

    expect((await call('DELETE', '/me', headers)).statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, account.id));
    expect(row).toMatchObject({ status: 'DELETED', name: 'Deleted user', email: null, phone: null, googleSubject: null });
    expect((await call('GET', '/me', headers)).statusCode).toBe(401);
    expect(await db.select().from(jobs).where(eq(jobs.id, job.id))).toHaveLength(1);

    // Signing in again with the same Google account starts a fresh account.
    const again = await signedIn();
    expect(again.account.id).not.toBe(account.id);
  });
});
