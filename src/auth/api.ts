import { config } from '../config';

/**
 * Calls to the Fundi-X server for signing in and the signed-in account.
 * The server's address comes from config (.env, never hard-coded).
 */

export type AccountRole = 'customer' | 'provider';

export type Account = {
  id: string;
  role: AccountRole;
  name: string;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  provider: {
    type: 'mechanic' | 'garage';
    businessName: string | null;
    specialty: string;
    verification: 'PENDING' | 'VERIFIED' | 'REJECTED';
  } | null;
  /** What the account still needs before it can be used. */
  nextStep: 'add_phone' | 'provider_profile' | null;
};

/** A refusal from the server, with its stable code (e.g. phone_in_use). */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  if (!config.apiUrl) {
    throw new ServerError(0, 'not_configured', 'The app has no server address (API_URL in .env).');
  }
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ServerError(0, 'unreachable', "Can't reach Fundi-X. Check your internet connection.");
  }
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (!res.ok) {
    throw new ServerError(
      res.status,
      data?.error ?? 'unknown',
      data?.message ?? 'Something went wrong. Please try again.',
    );
  }
  return data as T;
}

export const authApi = {
  config: () => request<{ googleClientId: string | null; appleEnabled: boolean }>('/auth/config'),
  signInWithGoogle: (credential: string, role: AccountRole) =>
    request<{ token: string; account: Account }>('/auth/google', {
      method: 'POST',
      body: { credential, role },
    }),
  me: (token: string) => request<Account>('/me', { token }),
  setPhone: (token: string, phone: string) =>
    request<Account>('/me/phone', { method: 'PUT', body: { phone }, token }),
  setProviderProfile: (
    token: string,
    profile: { type: 'mechanic' | 'garage'; businessName?: string; specialty: string },
  ) => request<Account>('/me/provider', { method: 'PUT', body: profile, token }),
  signOut: (token: string) => request('/auth/sign-out', { method: 'POST', token }),
  deleteAccount: (token: string) => request('/me', { method: 'DELETE', token }),
};
