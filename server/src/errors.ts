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

/** The request itself is wrong in a way the schema can't express. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** A feature that needs configuration (e.g. a secret) that isn't set. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

/** Called for errors nobody expected (HTTP 500), e.g. to record an incident. */
export type UnexpectedErrorHook = (
  error: Error,
  request: FastifyRequest,
) => Promise<void>;

/**
 * Turns errors into HTTP answers with a stable `error` code the app can
 * act on. Domain errors keep their meaning across the network: a
 * JobTransitionError on the phone and a 409 job_transition from the server
 * are the same event.
 *
 * Every error answer carries the request id, so a customer, the app or
 * support can quote it and engineering can find the exact request.
 */
export function createErrorHandler(onUnexpected?: UnexpectedErrorHook) {
  return async function errorHandler(
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const send = (status: number, code: string, message = error.message) =>
      reply
        .status(status)
        .send({ error: code, message, requestId: request.id });

    if (
      ('validation' in error && error.validation) ||
      error instanceof BadRequestError
    ) {
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
    if (error instanceof NotConfiguredError) {
      request.log.error(error);
      return send(503, 'not_configured');
    }
    // Fastify's own client errors (malformed JSON, body too large…): the
    // caller's mistake, not ours, so not an incident.
    const status = (error as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return send(status, 'invalid_request');
    }
    request.log.error(error);
    await onUnexpected?.(error, request);
    return send(500, 'internal', 'Something went wrong');
  };
}
