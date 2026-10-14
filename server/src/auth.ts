import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { accountForToken } from './accounts/sessions';
import type { Database } from './db/client';
import { users, type UserRole } from './db/schema';
import { ForbiddenError, UnauthenticatedError } from './errors';

/** Who is calling. Comes from the login token, never from the request body. */
export type Caller = { role: UserRole; id: string };

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook when the request carries a valid identity. */
    caller?: Caller;
  }
}

const DEV_ROLES: Record<string, UserRole> = {
  customer: 'CUSTOMER',
  provider: 'PROVIDER',
};

/** Only an active account may act; a deleted one no longer exists for us. */
function checkStatus(status: 'ACTIVE' | 'SUSPENDED' | 'DELETED') {
  if (status === 'SUSPENDED') {
    throw new ForbiddenError('This account is suspended');
  }
  if (status === 'DELETED') {
    throw new UnauthenticatedError();
  }
}

/**
 * Works out the caller once per request, first thing: before the body is
 * even read, so a stranger learns nothing about what a valid request is.
 *
 * The app sends `Authorization: Bearer <session token>`, which it got by
 * signing in with Google or Apple (accounts/routes.ts). The account is
 * checked on every request, so a suspension or sign-out takes effect at once.
 *
 * DEVELOPMENT ONLY (`allowDevHeader`, never in production): an `x-dev-user`
 * header such as `customer:customer-1` stands in for a session, for tests
 * and the local app before it signs in.
 */
export function registerAuth(
  app: FastifyInstance,
  db: Database,
  { allowDevHeader }: { allowDevHeader: boolean },
) {
  app.addHook('onRequest', async request => {
    const authorization = request.headers.authorization;
    if (authorization) {
      const [scheme, token] = authorization.split(' ');
      if (scheme !== 'Bearer' || !token) {
        throw new UnauthenticatedError();
      }
      const account = await accountForToken(db, token);
      if (!account) {
        throw new UnauthenticatedError();
      }
      checkStatus(account.status);
      request.caller = { role: account.role, id: account.id };
      return;
    }

    const header = request.headers['x-dev-user'];
    if (typeof header !== 'string') {
      return; // Anonymous: fine for /health and sign-in, refused by callerOf elsewhere.
    }
    if (!allowDevHeader) {
      throw new UnauthenticatedError();
    }
    const [roleName, id] = header.split(':');
    const role = DEV_ROLES[roleName];
    if (!role || !id) {
      throw new UnauthenticatedError();
    }
    const [user] = await db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, id));
    // An account that doesn't exist, or exists with another role.
    if (!user || user.role !== role) {
      throw new UnauthenticatedError();
    }
    checkStatus(user.status);
    request.caller = { role, id };
  });
}

export function callerOf(request: FastifyRequest): Caller {
  if (!request.caller) {
    throw new UnauthenticatedError();
  }
  return request.caller;
}

export function requireCustomer(request: FastifyRequest) {
  const caller = callerOf(request);
  if (caller.role !== 'CUSTOMER') {
    throw new ForbiddenError('Only customers can do this');
  }
  return caller;
}
