import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureOwner } from '../src/admin/bootstrap';
import type { GoogleVerifier } from '../src/admin/google';
import { SESSION_COOKIE } from '../src/admin/session';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { auditLog } from '../src/db/schema';
import { UnauthenticatedError } from '../src/errors';
import { resetTables } from './fixtures';

/** Stands in for Google: the credential "google:<email>:<account id>". */
const fakeGoogle: GoogleVerifier = async credential => {
  const [prefix, email, subject] = credential.split(':');
  if (prefix !== 'google' || !email || !subject) {
    throw new UnauthenticatedError();
  }
  return { email, subject };
};

const ORIGIN = 'http://admin.test';
const REASON = 'Hired for customer care';

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
      secureCookie: false,
      devSignIn: false,
    },
    signInPerMinute: 1000,
  });
});
beforeEach(async () => {
  await resetTables(db);
  await ensureOwner(db, 'owner@example.com');
});
afterAll(async () => {
  await app.close();
  await close();
});

type Session = Record<string, string>;

async function signIn(email: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/auth/google',
    headers: { origin: ORIGIN },
    payload: { credential: `google:${email}:g-${email}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { [SESSION_COOKIE]: res.cookies.find(c => c.name === SESSION_COOKIE)!.value };
}

const call = (session: Session, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url: `/admin${url}`, headers: { origin: ORIGIN }, cookies: session, ...(payload && { payload }) });

async function addStaff(owner: Session, email: string, role: string) {
  const res = await call(owner, 'POST', '/staff', { email, role, reason: REASON });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
}

describe('staff and roles', () => {
  it('lets the owner add someone, who can then sign in with that role only', async () => {
    const owner = await signIn('owner@example.com');
    await addStaff(owner, 'Agent@Example.com', 'SUPPORT');

    const list = (await call(owner, 'GET', '/staff')).json();
    expect(list.staff.map((s: { email: string; role: string }) => [s.email, s.role])).toEqual([
      ['owner@example.com', 'OWNER'],
      ['agent@example.com', 'SUPPORT'],
    ]);
    expect(list.roles.find((r: { id: string }) => r.id === 'SUPPORT').permissions).toContain('jobs.cancel');

    const agent = await signIn('agent@example.com');
    const me = (await call(agent, 'GET', '/me')).json();
    expect(me).toMatchObject({ role: 'SUPPORT' });
    expect(me.permissions).not.toContain('staff.manage');
    expect((await call(agent, 'GET', '/jobs')).statusCode).toBe(200);
    expect((await call(agent, 'GET', '/settings')).statusCode).toBe(403);
    expect((await call(agent, 'GET', '/staff')).statusCode).toBe(403);
    expect((await call(agent, 'POST', '/staff', { email: 'x@example.com', role: 'OWNER', reason: REASON })).statusCode).toBe(403);

    const actions = (await db.select().from(auditLog)).map(a => a.action);
    expect(actions).toContain('staff.add');
  });

  it('refuses duplicates, unknown roles and a missing reason', async () => {
    const owner = await signIn('owner@example.com');
    await addStaff(owner, 'agent@example.com', 'SUPPORT');
    expect((await call(owner, 'POST', '/staff', { email: 'AGENT@example.com', role: 'FINANCE', reason: REASON })).statusCode).toBe(409);
    expect((await call(owner, 'POST', '/staff', { email: 'b@example.com', role: 'GOD', reason: REASON })).statusCode).toBe(400);
    expect((await call(owner, 'POST', '/staff', { email: 'not-an-email', role: 'SUPPORT', reason: REASON })).statusCode).toBe(400);
    expect((await call(owner, 'POST', '/staff', { email: 'b@example.com', role: 'SUPPORT', reason: ' ' })).statusCode).toBe(400);
  });

  it('changes a role, effective on the next request', async () => {
    const owner = await signIn('owner@example.com');
    const id = await addStaff(owner, 'agent@example.com', 'SUPPORT');
    const agent = await signIn('agent@example.com');
    expect((await call(agent, 'GET', '/finance/books')).statusCode).toBe(403);

    const res = await call(owner, 'PUT', `/staff/${id}/role`, { role: 'FINANCE', reason: 'Moved to accounts' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call(agent, 'GET', '/me')).json().role).toBe('FINANCE');
    expect((await call(agent, 'GET', '/jobs')).statusCode).toBe(200);
    expect((await call(agent, 'GET', '/customers')).statusCode).toBe(403);
  });

  it('disabling ends their sessions and stops sign-in; enabling restores it', async () => {
    const owner = await signIn('owner@example.com');
    const id = await addStaff(owner, 'agent@example.com', 'SUPPORT');
    const agent = await signIn('agent@example.com');

    expect((await call(owner, 'POST', `/staff/${id}/disable`, { reason: 'Left the company' })).statusCode).toBe(200);
    expect((await call(agent, 'GET', '/me')).statusCode).toBe(401);
    const again = await app.inject({
      method: 'POST',
      url: '/admin/auth/google',
      headers: { origin: ORIGIN },
      payload: { credential: 'google:agent@example.com:g-agent@example.com' },
    });
    expect(again.statusCode).toBe(403);

    expect((await call(owner, 'POST', `/staff/${id}/enable`, { reason: 'Came back' })).statusCode).toBe(200);
    await signIn('agent@example.com');
  });

  it('never lets anyone change their own access or remove the last owner', async () => {
    const owner = await signIn('owner@example.com');
    const ownerId = (await call(owner, 'GET', '/me')).json().id;
    expect((await call(owner, 'PUT', `/staff/${ownerId}/role`, { role: 'SUPPORT', reason: REASON })).statusCode).toBe(403);
    expect((await call(owner, 'POST', `/staff/${ownerId}/disable`, { reason: REASON })).statusCode).toBe(403);

    // A second owner can't demote the first while that would leave none:
    // here there are two, so it works once, and then the rule bites.
    const secondId = await addStaff(owner, 'second@example.com', 'OWNER');
    const second = await signIn('second@example.com');
    expect((await call(second, 'PUT', `/staff/${ownerId}/role`, { role: 'MANAGER', reason: REASON })).statusCode).toBe(200);
    // The first is now a manager and can't touch staff at all.
    expect((await call(owner, 'POST', `/staff/${secondId}/disable`, { reason: REASON })).statusCode).toBe(403);
  });
});
