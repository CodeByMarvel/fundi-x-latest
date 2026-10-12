import { buildApp } from './app';
import { createDatabase } from './db/client';

const PORT = Number(process.env.PORT ?? 3000);
// Data survives restarts in ./data; delete the folder to start over.
const DATA_DIR = process.env.DATA_DIR ?? './data/pglite';

const { db } = await createDatabase({ dataDir: DATA_DIR });
const app = buildApp({ db, logger: true });

// 0.0.0.0 so a phone on the same Wi-Fi can reach it during development.
await app.listen({ port: PORT, host: '0.0.0.0' });
