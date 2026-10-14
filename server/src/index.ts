import { existsSync } from 'node:fs';
import { ensureOwner } from './admin/bootstrap';
import { appleVerifier } from './accounts/apple';
import { googleVerifier } from './admin/google';
import { buildApp } from './app';
import { createDatabase } from './db/client';
import { seedDevData } from './db/devSeed';
import { startTimerWorker } from './timers/worker';

// Local configuration and secrets (never committed); see .env.example.
// On a host, the same names are set in its environment settings instead.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 3000);
// A PostgreSQL server: in development the one `npm run dev` starts
// (db/devPostgres.ts), in production a hosted one.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing: set it in server/.env (see .env.example).');
  process.exit(1);
}

const { db, close } = await createDatabase({ url: DATABASE_URL });
if (!IS_PRODUCTION) {
  await seedDevData(db);
}
const app = buildApp({
  db,
  logger: true,
  // The x-dev-user stand-in for a signed-in session: never in production.
  allowDevHeader: !IS_PRODUCTION,
  accounts: {
    // The app's Google sign-in uses the same web client id as the portal.
    verifyGoogle: googleVerifier(process.env.GOOGLE_CLIENT_ID),
    verifyApple: appleVerifier(process.env.APPLE_BUNDLE_ID),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    appleEnabled: !!process.env.APPLE_BUNDLE_ID,
  },
  admin: {
    verifyGoogle: googleVerifier(process.env.GOOGLE_CLIENT_ID),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:5173',
    secureCookie: IS_PRODUCTION,
    // Never in production, whatever .env says.
    devSignIn: !IS_PRODUCTION && process.env.ADMIN_DEV_SIGN_IN === 'true',
  },
});

const owner = await ensureOwner(db, process.env.OWNER_EMAIL);
if (owner === 'created') {
  app.log.info('Admin console owner account created from OWNER_EMAIL');
} else if (owner === 'missing') {
  app.log.warn('No admin staff yet: set OWNER_EMAIL in server/.env');
}
if (process.env.ADMIN_DEV_SIGN_IN === 'true') {
  if (IS_PRODUCTION) {
    app.log.error('ADMIN_DEV_SIGN_IN is ignored in production: remove it');
  } else {
    app.log.warn('Admin development sign-in is ON (this computer only)');
  }
}
if (!process.env.GOOGLE_CLIENT_ID) {
  app.log.warn('Admin sign-in is off: set GOOGLE_CLIENT_ID in server/.env');
}

const stopTimers = startTimerWorker(db, {
  onRun: run => app.log.info({ timers: run }, 'timers fired'),
  onError: err => app.log.error({ err }, 'timer check failed'),
});

// Ctrl+C: let a running timer finish before the database closes.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await stopTimers();
    await app.close();
    await close();
    process.exit(0);
  });
}

// 0.0.0.0 so a phone on the same Wi-Fi can reach it during development.
await app.listen({ port: PORT, host: '0.0.0.0' });
