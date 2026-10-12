import Fastify from 'fastify';
import type { Database } from './db/client';
import { errorHandler } from './errors';
import { registerJobRoutes } from './jobs/routes';

/**
 * Builds the API without starting it, so tests can call it directly
 * (app.inject) against their own fresh database.
 */
export function buildApp({
  db,
  logger = false,
}: {
  db: Database;
  logger?: boolean;
}) {
  const app = Fastify({ logger });
  app.setErrorHandler(errorHandler);
  app.get('/health', async () => ({ ok: true }));
  registerJobRoutes(app, db);
  return app;
}
