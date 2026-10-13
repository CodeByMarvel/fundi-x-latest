import cookie from '@fastify/cookie';
import Fastify from 'fastify';
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

/**
 * Builds the API without starting it, so tests can call it directly
 * (app.inject) against their own fresh database.
 */
export function buildApp({
  db,
  logger = false,
  admin = LOCAL_ADMIN,
}: {
  db: Database;
  logger?: boolean;
  admin?: AdminConfig;
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
  registerAuth(app, db);
  app.get('/health', async () => ({ ok: true }));
  registerJobRoutes(app, db);
  registerAdminRoutes(app, db, admin);
  return app;
}
