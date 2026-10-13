import { buildApp } from './app';
import { createDatabase } from './db/client';
import { seedDevData } from './db/devSeed';
import { startTimerWorker } from './timers/worker';

const PORT = Number(process.env.PORT ?? 3000);
// Data survives restarts in ./data; delete the folder to start over.
const DATA_DIR = process.env.DATA_DIR ?? './data/pglite';

const { db, close } = await createDatabase({ dataDir: DATA_DIR });
if (process.env.NODE_ENV !== 'production') {
  await seedDevData(db);
}
const app = buildApp({ db, logger: true });

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
