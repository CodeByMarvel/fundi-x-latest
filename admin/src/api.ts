/**
 * Talks to the server's /admin API. The session lives in an httpOnly
 * cookie the browser sends by itself; this code never sees or stores it.
 */

/** Empty in development (Vite passes requests on); set for production. */
const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's stable code, e.g. "forbidden", "invalid_request". */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the session has ended, so the app can show sign-in again. */
export const SIGNED_OUT_EVENT = 'fundix:signed-out';

async function request<T>(url: string, method = 'GET', body?: unknown) {
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}`, {
      method,
      credentials: 'include',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new ApiError(0, 'unreachable', "Can't reach the Fundi-X server.");
  }
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? 'unknown',
      data?.message ?? `Request failed (${res.status})`,
    );
  }
  return data as T;
}

/** An /admin call. A 401 means the session ended: everyone is told. */
export async function api<T>(path: string, method = 'GET', body?: unknown) {
  try {
    return await request<T>(`/admin${path}`, method, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && path !== '/me') {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw err;
  }
}

export const serverHealth = () =>
  request<{ ok: boolean }>('/health').then(
    r => r.ok,
    () => false,
  );

export type Permission =
  | 'jobs.view'
  | 'jobs.cancel'
  | 'money.view'
  | 'money.refund'
  | 'users.view'
  | 'users.suspend'
  | 'providers.verify'
  | 'settings.edit'
  | 'logs.view'
  | 'staff.manage';

export type Me = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: Permission[];
};

export type SettingRow = {
  key: string;
  value: unknown;
  default: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AuditEntry = {
  id: string;
  staffId: string | null;
  staffEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
};
