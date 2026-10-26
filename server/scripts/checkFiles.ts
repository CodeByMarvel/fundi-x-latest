import { existsSync } from 'node:fs';
import { r2ConfigFromEnv, r2FileStore } from '../src/storage/files';

/**
 * `npm run files-check`: proves the R2 settings work, the way the app and
 * admin website will use them. Writes two small files, reads them back
 * through short-lived links, and deletes them again.
 */

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const config = r2ConfigFromEnv(process.env);
if (!config) {
  console.error('No file storage settings: set the R2_* values in server/.env (docs/files.md).');
  process.exit(1);
}
const files = r2FileStore(config);
const stamp = Date.now();
const direct = `checks/${stamp}-server.txt`;
const viaLink = `checks/${stamp}-phone.txt`;

async function step(label: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`ok    ${label}`);
  } catch (err) {
    console.error(`FAIL  ${label}\n      ${(err as Error).message}`);
    await files.delete(direct).catch(() => {});
    await files.delete(viaLink).catch(() => {});
    process.exit(1);
  }
}

console.log(`Bucket ${files.bucket}`);
await step('server saves a file', () => files.put(direct, 'hello from the server', 'text/plain'));
await step('server sees its size', async () => {
  const info = await files.head(direct);
  if (info?.bytes !== 21) {
    throw new Error(`expected 21 bytes, got ${JSON.stringify(info)}`);
  }
});
await step('a phone uploads through a one-time link', async () => {
  const res = await fetch(await files.uploadUrl(viaLink), {
    method: 'PUT',
    body: 'hello from a phone',
    headers: { 'content-type': 'text/plain' },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
});
await step('a browser reads it through a viewing link', async () => {
  const res = await fetch(await files.downloadUrl(viaLink));
  const text = await res.text();
  if (text !== 'hello from a phone') {
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
});
await step('without a link, the file is private', async () => {
  const res = await fetch(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${viaLink}`);
  if (res.ok) {
    throw new Error('the bucket answered without a signature: turn off public access');
  }
});
await step('files are deleted', async () => {
  await files.delete(direct);
  await files.delete(viaLink);
  if (await files.head(viaLink)) {
    throw new Error('still there after delete');
  }
});
console.log('File storage works.');
