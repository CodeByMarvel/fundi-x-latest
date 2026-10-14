import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { appleVerifier } from './accounts/apple';
import { registerAccountRoutes, type AccountsConfig } from './accounts/routes';
import { googleVerifier } from './admin/google';
import { registerAdminRoutes, type AdminConfig } from './admin/routes';
import { registerAuth } from './auth';
import type { Database } from './db/client';
import { createErrorHandler } from './errors';
import { newId } from './ids';
import { describeError, reportIncident } from './incidents';
import { registerJobRoutes } from './jobs/routes';

/** Local development: no Google sign-in until GOOGLE_CLIENT_ID is set. */
const LOCAL_ADMIN: AdminConfig = {
  verifyGoogle: googleVerifier(undefined),
  googleClientId: null,
  origin: 'http://localhost:5173',
  secureCookie: false,
  devSignIn: false,
};

/** Local development: Google and Apple sign-in off until configured. */
const LOCAL_ACCOUNTS: AccountsConfig = {
  verifyGoogle: googleVerifier(undefined),
  verifyApple: appleVerifier(undefined),
  googleClientId: null,
  appleEnabled: false,
};

/**
 * Builds the API without starting it, so tests can call it directly
 * (app.inject) against their own fresh database.
 */
export function buildApp({
  db,
  logger = false,
  admin = LOCAL_ADMIN,
  accounts = LOCAL_ACCOUNTS,
  allowDevHeader = true,
  signInPerMinute = 10,
}: {
  db: Database;
  logger?: boolean;
  admin?: AdminConfig;
  accounts?: AccountsConfig;
  /** The x-dev-user stand-in for a session. index.ts turns it off in production. */
  allowDevHeader?: boolean;
  /** Sign-in attempts allowed per minute from one address (app and portal). */
  signInPerMinute?: number;
}) {
  const app = Fastify({
    logger,
    // Our own ids (req_…), never one sent by the caller, so a log line, an
    // incident and an error message can always be matched up.
    genReqId: () => newId('req'),
    requestIdHeader: false,
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setErrorHandler(
    createErrorHandler((error, request) =>
      reportIncident(
        db,
        {
          kind: 'server_error',
          title: `${error.name}: ${error.message}`,
          where: `${request.method} ${request.routeOptions.url ?? request.url}`,
          detail: {
            method: request.method,
            route: request.routeOptions.url ?? null,
            url: request.url,
            ...describeError(error),
          },
          requestId: request.id,
        },
        request.log,
      ),
    ),
  );
  app.register(cookie);
  // Only routes that ask for it are limited (sign-in), per address.
  app.register(rateLimit, { global: false });
  registerAuth(app, db, { allowDevHeader });
  app.get('/health', async () => ({ ok: true }));
  registerJobRoutes(app, db);
  // Inside a plugin so it loads after the rate limiter, which only sees
  // routes added once it is ready.
  app.register(async scope => registerAccountRoutes(scope, db, { ...accounts, signInPerMinute }));
  registerAdminRoutes(app, db, { ...admin, signInPerMinute });
  return app;
}
