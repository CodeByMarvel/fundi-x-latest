import type { FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthenticatedError } from './errors';

/** Who is calling. Comes from the login token, never from the request body. */
export type Caller =
  | { role: 'CUSTOMER'; id: string }
  | { role: 'PROVIDER'; id: string };

/**
 * DEVELOPMENT ONLY: reads the caller from an `x-dev-user` header such as
 * `customer:customer-1` or `provider:p1`. Real login (phone number + SMS
 * code) will replace this with a signed token; nothing else changes,
 * because every handler only ever asks `callerOf(request)`.
 */
export function callerOf(request: FastifyRequest): Caller {
  const header = request.headers['x-dev-user'];
  const [role, id] = typeof header === 'string' ? header.split(':') : [];
  if (!id) {
    throw new UnauthenticatedError();
  }
  if (role === 'customer') {
    return { role: 'CUSTOMER', id };
  }
  if (role === 'provider') {
    return { role: 'PROVIDER', id };
  }
  throw new UnauthenticatedError();
}

export function requireCustomer(request: FastifyRequest) {
  const caller = callerOf(request);
  if (caller.role !== 'CUSTOMER') {
    throw new ForbiddenError('Only customers can do this');
  }
  return caller;
}
