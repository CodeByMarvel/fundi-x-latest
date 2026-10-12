import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { JobTransitionError } from '../../src/domain/jobs/transitions';
import { PriceChangedError } from '../../src/domain/pricing/PricingService';

/** The thing asked for doesn't exist, or isn't this caller's to see. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** No (valid) identity on the request. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Sign in first');
    this.name = 'UnauthenticatedError';
  }
}

/** Signed in, but this kind of user can't do this at all. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Turns errors into HTTP answers with a stable `error` code the app can
 * act on. Domain errors keep their meaning across the network: a
 * JobTransitionError on the phone and a 409 job_transition from the server
 * are the same event.
 */
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const send = (status: number, code: string, message = error.message) =>
    reply.status(status).send({ error: code, message });

  if ('validation' in error && error.validation) {
    return send(400, 'invalid_request');
  }
  if (error instanceof UnauthenticatedError) {
    return send(401, 'unauthenticated');
  }
  if (error instanceof ForbiddenError) {
    return send(403, 'forbidden');
  }
  if (error instanceof NotFoundError) {
    return send(404, 'not_found');
  }
  if (error instanceof JobTransitionError) {
    return send(409, 'job_transition');
  }
  if (error instanceof PriceChangedError) {
    return send(409, 'price_changed');
  }
  request.log.error(error);
  return send(500, 'internal', 'Something went wrong');
}
