import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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

/**
 * Works out the caller once per request, first thing: before the body is
 * even read, so a stranger learns nothing about what a valid request is.
 *
 * DEVELOPMENT ONLY: the identity comes from an `x-dev-user` header such as
 * `customer:customer-1` or `provider:p1`. Real login (phone number + SMS
 * code) will replace the header with a signed token; the account checks
 * below stay, and handlers keep asking `callerOf(request)`.
 */
export function registerAuth(app: FastifyInstance, db: Database) {
  app.addHook('onRequest', async request => {
    const header = request.headers['x-dev-user'];
    if (typeof header !== 'string') {
      return; // Anonymous: fine for /health, refused by callerOf elsewhere.
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
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('This account is suspended');
    }
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
