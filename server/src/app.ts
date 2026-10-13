import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { googleVerifier } from './admin/google';
import { registerAdminRoutes, type AdminConfig } from './admin/routes';
import { registerAuth } from './auth';
import type { Database } from './db/client';
import { errorHandler } from './errors';
import { registerJobRoutes } from './jobs/routes';

/** Local development: no Google sign-in until GOOGLE_CLIENT_ID is set. */
const LOCAL_ADMIN: AdminConfig = {
  verifyGoogle: googleVerifier(undefined),
  origin: 'http://localhost:5173',
  secureCookie: false,
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
  const app = Fastify({ logger });
  app.setErrorHandler(errorHandler);
  app.register(cookie);
  registerAuth(app, db);
  app.get('/health', async () => ({ ok: true }));
  registerJobRoutes(app, db);
  registerAdminRoutes(app, db, admin);
  return app;
}
