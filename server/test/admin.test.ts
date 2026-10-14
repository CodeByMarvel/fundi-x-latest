import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kes } from '../../src/domain/money';
import { CALL_OUT_FEE } from '../../src/domain/pricing/engine';
import { ensureOwner } from '../src/admin/bootstrap';
import type { GoogleVerifier } from '../src/admin/google';
import { PERMISSIONS } from '../src/admin/permissions';
import { SESSION_COOKIE } from '../src/admin/session';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { auditLog, staff } from '../src/db/schema';
import { UnauthenticatedError } from '../src/errors';
import { getSetting } from '../src/settings';
import { REPAIR, resetTables, WANJIRU } from './fixtures';

/** Stands in for Google: the credential "google:<email>:<account id>". */
const fakeGoogle: GoogleVerifier = async credential => {
  const [prefix, email, subject] = credential.split(':');
  if (prefix !== 'google' || !email || !subject) {
    throw new UnauthenticatedError();
  }
  return { email, subject, name: 'Owner' };
};

const ORIGIN = 'http://admin.test';
const OWNER = 'Owner@Example.com';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  app = buildApp({
    db,
    admin: {
      verifyGoogle: fakeGoogle,
      googleClientId: 'test-client-id',
      origin: ORIGIN,
      secureCookie: true,
      devSignIn: false,
    },
    signInPerMinute: 1000, // many sign-ins per minute in tests
  });
});
beforeEach(async () => {
  await resetTables(db);
  await ensureOwner(db, OWNER);
});
afterAll(async () => {
  await app.close();
  await close();
});

const signIn = (credential: string) =>
  app.inject({
    method: 'POST',
    url: '/admin/auth/google',
    headers: { origin: ORIGIN },
    payload: { credential },
  });

/** Signs the owner in and returns the session cookie for later requests. */
async function ownerSession() {
  const res = await signIn('google:owner@example.com:g-123');
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find(c => c.name === SESSION_COOKIE);
  return { [SESSION_COOKIE]: cookie!.value };
}

const actions = async () =>
  (await db.select().from(auditLog)).map(a => a.action);

describe('the owner account', () => {
  it('comes from OWNER_EMAIL once, while there are no staff', async () => {
    const all = await db.select().from(staff);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ email: 'owner@example.com', role: 'OWNER' });

    // Changing the configured email later never adds a second owner.
    expect(await ensureOwner(db, 'someone@else.com')).toBe('exists');
    expect(await db.select().from(staff)).toHaveLength(1);
  });

  it('is not created without an email', async () => {
    await resetTables(db);
    expect(await ensureOwner(db, undefined)).toBe('missing');
    expect(await db.select().from(staff)).toHaveLength(0);
  });
});

describe('signing in', () => {
  it('lets the owner in with a session cookie the page cannot read', async () => {
    const res = await signIn('google:owner@example.com:g-123');
    expect(res.statusCode).toBe(200);
    expect(res.json().permissions).toEqual([...PERMISSIONS]);
    const cookie = res.cookies.find(c => c.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: true });

    const me = await app.inject({ url: '/admin/me', cookies: { [SESSION_COOKIE]: cookie.value } });
    expect(me.json()).toMatchObject({ email: 'owner@example.com', role: 'OWNER' });
    expect(await actions()).toContain('staff.sign_in');
  });

  it('refuses any other Google account, and records the attempt', async () => {
    const res = await signIn('google:stranger@gmail.com:g-999');
    expect(res.statusCode).toBe(403);
    const [denied] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.sign_in_denied'));
    expect(denied.after).toEqual({ email: 'stranger@gmail.com', reason: 'not_staff' });
  });

  it('ties the email to the first Google account that used it', async () => {
    await ownerSession();
    // Same address, different Google account: refused.
    expect((await signIn('google:owner@example.com:g-other')).statusCode).toBe(403);
  });

  it('tells the sign-in page which Google client to use', async () => {
    const res = await app.inject({ url: '/admin/config' });
    expect(res.json()).toEqual({
      googleClientId: 'test-client-id',
      devSignIn: false,
    });
  });

  it('refuses a credential Google did not issue', async () => {
    expect((await signIn('forged')).statusCode).toBe(401);
  });

  it('says so when Google sign-in is not configured', async () => {
    const unconfigured = buildApp({ db });
    const res = await unconfigured.inject({
      method: 'POST',
      url: '/admin/auth/google',
      headers: { origin: 'http://localhost:5173' },
      payload: { credential: 'anything' },
    });
    expect(res.statusCode).toBe(503);
    await unconfigured.close();
  });
});

describe('sessions', () => {
  it('are required: the phone app identities mean nothing here', async () => {
    expect((await app.inject({ url: '/admin/me' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/admin/me', headers: WANJIRU })).statusCode).toBe(401);
  });

  it('stop working at sign-out', async () => {
    const cookies = await ownerSession();
    await app.inject({ method: 'POST', url: '/admin/auth/sign-out', headers: { origin: ORIGIN }, cookies });
    expect((await app.inject({ url: '/admin/me', cookies })).statusCode).toBe(401);
    expect(await actions()).toContain('staff.sign_out');
  });

  it('stop working the moment the account is disabled', async () => {
    const cookies = await ownerSession();
    await db.update(staff).set({ status: 'DISABLED' });
    expect((await app.inject({ url: '/admin/me', cookies })).statusCode).toBe(403);
  });

  it('cannot be used by another website to change things', async () => {
    const cookies = await ownerSession();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/settings/call_out_fee',
      headers: { origin: 'https://evil.example' },
      cookies,
      payload: { value: kes(100) },
    });
    expect(res.statusCode).toBe(403);
    expect(await getSetting(db, 'call_out_fee')).toBe(CALL_OUT_FEE);
  });
});

describe('settings from the console', () => {
  const put = (cookies: Record<string, string>, value: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/admin/settings/call_out_fee',
      headers: { origin: ORIGIN },
      cookies,
      payload: { value, reason: 'Testing the fee change' },
    });

  it('changes the call-out fee customers are quoted, and logs before/after', async () => {
    const cookies = await ownerSession();
    expect((await put(cookies, kes(1000))).statusCode).toBe(200);

    const quote = await app.inject({
      method: 'POST',
      url: '/pricing/estimate',
      headers: WANJIRU,
      payload: REPAIR,
    });
    expect(quote.json().callOut).toBe(kes(1000));

    const [change] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'settings.update'));
    expect(change).toMatchObject({
      targetId: 'call_out_fee',
      before: CALL_OUT_FEE,
      after: kes(1000),
      reason: 'Testing the fee change',
    });
    expect(change.staffId).toBeTruthy();
    expect(change.requestId).toBeTruthy();

    const list = await app.inject({ url: '/admin/settings', cookies });
    expect(list.json()[0]).toMatchObject({ key: 'call_out_fee', value: kes(1000), default: CALL_OUT_FEE });
  });

  it('refuses values that are surely mistakes', async () => {
    const cookies = await ownerSession();
    for (const value of [0, kes(8_000_000), 80_050, '800', null]) {
      expect((await put(cookies, value)).statusCode).toBe(400);
    }
    expect(await getSetting(db, 'call_out_fee')).toBe(CALL_OUT_FEE);
  });

  it('has an audit log the owner can read, newest first', async () => {
    const cookies = await ownerSession();
    await put(cookies, kes(900));
    const res = await app.inject({ url: '/admin/audit', cookies });
    const rows: { action: string; createdAt: string; staffEmail: string }[] =
      res.json();
    expect(rows[0].staffEmail).toBe('owner@example.com');
    expect(rows.map(a => a.action)).toEqual(
      expect.arrayContaining(['settings.update', 'staff.sign_in']),
    );
    const times = rows.map(a => Date.parse(a.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('development sign-in', () => {
  const devApp = () =>
    buildApp({
      db,
      admin: {
        verifyGoogle: fakeGoogle,
        googleClientId: null,
        origin: ORIGIN,
        secureCookie: false,
        devSignIn: true,
      },
    });
  const devSignIn = (target: ReturnType<typeof buildApp>, remoteAddress = '127.0.0.1') =>
    target.inject({
      method: 'POST',
      url: '/admin/auth/dev',
      headers: { origin: ORIGIN },
      remoteAddress,
    });

  it('does not exist unless switched on', async () => {
    expect((await devSignIn(app)).statusCode).toBe(404);
  });

  it('signs in as the owner from this computer, and says how in the log', async () => {
    const local = devApp();
    const res = await devSignIn(local);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: 'owner@example.com', role: 'OWNER' });
    const cookie = res.cookies.find(c => c.name === SESSION_COOKIE)!;
    const me = await local.inject({ url: '/admin/me', cookies: { [SESSION_COOKIE]: cookie.value } });
    expect(me.statusCode).toBe(200);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.sign_in'));
    expect(entry.after).toEqual({ method: 'dev' });
    await local.close();
  });

  it('refuses other devices on the Wi-Fi', async () => {
    const local = devApp();
    expect((await devSignIn(local, '192.168.100.23')).statusCode).toBe(403);
    await local.close();
  });

  it('still needs the request to come from the admin console', async () => {
    const local = devApp();
    const res = await local.inject({
      method: 'POST',
      url: '/admin/auth/dev',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    await local.close();
  });
});
