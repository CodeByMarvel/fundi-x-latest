import { expect } from 'vitest';
import { ensureOwner } from '../src/admin/bootstrap';
import { googleVerifier } from '../src/admin/google';
import { SESSION_COOKIE } from '../src/admin/session';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { booking, BRIAN, REPAIR, resetTables, WANJIRU } from './fixtures';

export const ADMIN_ORIGIN = 'http://admin.test';

type Headers = Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * An app with the admin console on, plus helpers for both sides: staff
 * calls (cookie + origin) and phone-app calls (x-dev-user headers).
 */
export function adminHarness(db: Database) {
  const app = buildApp({
    db,
    admin: {
      verifyGoogle: googleVerifier(undefined),
      googleClientId: null,
      origin: ADMIN_ORIGIN,
      secureCookie: false,
      devSignIn: true,
    },
    signInPerMinute: 1000,
  });
  let cookies: Record<string, string> = {};

  /** Empties the database and signs in as the owner. */
  async function reset() {
    await resetTables(db);
    await ensureOwner(db, 'owner@example.com');
    const res = await app.inject({ method: 'POST', url: '/admin/auth/dev', headers: { origin: ADMIN_ORIGIN } });
    cookies = { [SESSION_COOKIE]: res.cookies.find(c => c.name === SESSION_COOKIE)!.value };
  }

  /** A staff request; returns the raw response. */
  const staff = (method: Method, url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/admin${url}`,
      headers: { origin: ADMIN_ORIGIN },
      cookies,
      ...(payload !== undefined && { payload: payload as object }),
    });

  /** A staff request that must succeed; returns the JSON. */
  async function staffOk(method: Method, url: string, payload?: unknown) {
    const res = await staff(method, url, payload);
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json();
  }

  /** A phone-app request that must succeed; returns the JSON. */
  async function appOk(method: Method, url: string, headers: Headers, payload?: object) {
    const res = await app.inject({ method, url, headers, ...(payload && { payload }) });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json();
  }

  /** Pays whatever the job is waiting for, answering the simulated prompt. */
  async function pay(jobId: string, headers: Headers = WANJIRU, extra: object = {}) {
    const payment = await appOk('POST', `/jobs/${jobId}/pay`, headers, { phone: '0700000001', ...extra });
    await appOk('POST', `/dev/payments/${payment.id}/respond`, headers, { response: 'pay' });
    return payment;
  }

  /** Booked, call-out paid, and Brian on site. */
  async function arrived(details = REPAIR, headers: Headers = WANJIRU, partsOption?: 'MECHANIC' | 'OWN') {
    await appOk('PUT', '/provider/availability', BRIAN, { online: true, location: REPAIR.location.coords });
    const job = await appOk('POST', '/jobs', headers, booking({ ...details, ...(partsOption && { partsOption }) }));
    await pay(job.id, headers);
    for (const step of ['accept', 'start-trip', 'arrived']) {
      await appOk('POST', `/jobs/${job.id}/${step}`, BRIAN);
    }
    return job.id as string;
  }

  return { app, reset, staff, staffOk, appOk, pay, arrived };
}
