import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/client';
import { auditLog, files, incidents, providers, users } from '../src/db/schema';
import { MAX_FILE_BYTES, UPLOADS_PER_PERSON_PER_HOUR } from '../src/files/rules';
import { runFileUpkeep } from '../src/files/service';
import { setSetting } from '../src/settings';
import { adminHarness } from './adminHarness';
import { BRIAN, OTIENO, SERVICE, WANJIRU } from './fixtures';
import { memoryFiles } from './memoryFiles';

let db: Database;
let close: () => Promise<void>;
let h: ReturnType<typeof adminHarness>;
let mem: ReturnType<typeof memoryFiles>;

/** A mechanic still applying (Brian, p1, is already verified). */
const AMINA = { 'x-dev-user': 'provider:p2' };

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  mem = memoryFiles();
  h = adminHarness(db, { files: mem.store });
});
beforeEach(async () => {
  await h.reset();
  mem.objects.clear();
  const at = new Date();
  await db.insert(users).values({ id: 'p2', phone: '254712000202', name: 'Amina', role: 'PROVIDER', status: 'ACTIVE', createdAt: at, updatedAt: at });
  await db.insert(providers).values({ userId: 'p2', type: 'mechanic', specialty: 'Engine', payoutPhone: '254712000202', verification: 'PENDING', createdAt: at, updatedAt: at });
});
afterAll(async () => {
  await h.app.close();
  await close();
});

const JPEG = 'image/jpeg';

const ask = (headers: Record<string, string>, body: object) =>
  h.app.inject({ method: 'POST', url: '/files', headers, payload: { purpose: 'MECHANIC_DOCUMENT', kind: 'id_front', contentType: JPEG, bytes: 300_000, ...body } });

const confirm = (headers: Record<string, string>, id: string) =>
  h.app.inject({ method: 'POST', url: `/files/${id}/confirm`, headers });

/** Ask, upload what was announced, confirm. */
async function uploaded(headers: Record<string, string>, body: object = {}, actual?: { bytes: number; type: string }) {
  const res = await ask(headers, body);
  expect(res.statusCode, res.body).toBe(200);
  const link = res.json();
  mem.upload(link.uploadUrl, actual?.bytes ?? 300_000, actual?.type ?? link.headers['content-type']);
  return { link, confirmed: await confirm(headers, link.id) };
}

async function disputed() {
  const id = await h.arrived(SERVICE);
  await h.appOk('POST', `/jobs/${id}/ready-to-start`, BRIAN);
  await h.pay(id);
  await h.appOk('POST', `/jobs/${id}/complete`, BRIAN, {});
  await h.appOk('POST', `/jobs/${id}/dispute`, WANJIRU, { reason: 'Oil is leaking' });
  return id;
}

describe('uploads', () => {
  it('ask for a link, upload, confirm; staff view it through a link that is audited', async () => {
    const { link, confirmed } = await uploaded(AMINA);
    expect(link).toMatchObject({ method: 'PUT', headers: { 'content-type': JPEG } });
    expect(link.uploadUrl).toContain('mechanic/p2/');
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ id: link.id, kind: 'id_front', status: 'READY', bytes: 300_000 });
    // The app sees details only, never a link or the storage key.
    const mine = await h.appOk('GET', '/files', AMINA);
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('memory://');

    const [listed] = await h.staffOk('GET', '/files?ownerId=p2');
    expect(listed).toMatchObject({ id: link.id, status: 'READY' });
    const view = await h.staffOk('POST', `/files/${link.id}/link`);
    expect(view.url).toMatch(/^memory:\/\/get\/mechanic\/p2\//);
    const actions = (await db.select().from(auditLog)).map(a => a.action);
    expect(actions).toContain('file.view');
  });

  it('refuses before handing out a link: wrong type, too big, wrong person', async () => {
    expect((await ask(AMINA, { contentType: 'application/pdf' })).statusCode).toBe(400); // ID: photo only
    expect((await ask(AMINA, { kind: 'good_conduct', contentType: 'application/pdf' })).statusCode).toBe(200);
    expect((await ask(AMINA, { contentType: 'text/html' })).statusCode).toBe(400);
    expect((await ask(AMINA, { bytes: MAX_FILE_BYTES + 1 })).statusCode).toBe(400);
    expect((await ask(AMINA, { kind: 'passport_scan' })).statusCode).toBe(400);
    expect((await ask(WANJIRU, {})).statusCode).toBe(403); // customers have no documents
    expect((await h.app.inject({ method: 'POST', url: '/files', payload: {} })).statusCode).toBe(400);
  });

  it('checks what really arrived, and deletes a file that breaks the rules', async () => {
    const early = (await ask(AMINA, {})).json();
    expect((await confirm(AMINA, early.id)).json().error).toBe('not_uploaded');

    const big = await uploaded(AMINA, {}, { bytes: MAX_FILE_BYTES + 1, type: JPEG });
    expect(big.confirmed.statusCode).toBe(400);
    const swapped = await uploaded(AMINA, {}, { bytes: 1000, type: 'text/html' });
    expect(swapped.confirmed.statusCode).toBe(400);

    const rows = await db.select().from(files).where(eq(files.status, 'REJECTED'));
    expect(rows.map(r => r.statusReason).sort()).toEqual(['too_big', 'wrong_type']);
    for (const r of rows) {
      expect(mem.objects.has(r.key)).toBe(false);
    }
  });

  it('a new document replaces the previous one of the same kind', async () => {
    const first = await uploaded(AMINA);
    const second = await uploaded(AMINA);
    expect(second.confirmed.statusCode).toBe(200);
    const [old] = await db.select().from(files).where(eq(files.id, first.link.id));
    expect(old).toMatchObject({ status: 'DELETED', statusReason: 'replaced' });
    expect(mem.objects.has(old.key)).toBe(false);
    expect(await h.appOk('GET', '/files', AMINA)).toHaveLength(1);
  });

  it('an applicant may remove a document; a verified mechanic only replaces', async () => {
    const amina = await uploaded(AMINA);
    expect((await h.app.inject({ method: 'DELETE', url: `/files/${amina.link.id}`, headers: AMINA })).statusCode).toBe(200);
    const brian = await uploaded(BRIAN);
    const res = await h.app.inject({ method: 'DELETE', url: `/files/${brian.link.id}`, headers: BRIAN });
    expect(res.json().error).toBe('verified');
    // Nobody can touch someone else's file.
    expect((await confirm(AMINA, brian.link.id)).statusCode).toBe(404);
  });
});

describe('dispute photos', () => {
  it('only the two sides of a job in dispute, at most 6 each', async () => {
    const id = await disputed();
    const photo = { purpose: 'DISPUTE_PHOTO', kind: 'evidence', jobId: id };
    expect((await ask(OTIENO, photo)).statusCode).toBe(404); // not their job
    expect((await ask(WANJIRU, { ...photo, jobId: undefined })).statusCode).toBe(400);
    for (let i = 0; i < 6; i++) {
      expect((await uploaded(WANJIRU, photo)).confirmed.statusCode).toBe(200);
    }
    expect((await ask(WANJIRU, photo)).json().error).toBe('too_many_files');
    expect((await uploaded(BRIAN, photo)).confirmed.statusCode).toBe(200);
    expect(await h.staffOk('GET', `/files?jobId=${id}`)).toHaveLength(7);
  });

  it('not before a job is disputed', async () => {
    const id = await h.arrived(SERVICE);
    const res = await ask(WANJIRU, { purpose: 'DISPUTE_PHOTO', kind: 'evidence', jobId: id });
    expect(res.json().error).toBe('not_disputed');
  });
});

describe('limits that keep storage free', () => {
  it(`one person: ${UPLOADS_PER_PERSON_PER_HOUR} upload links an hour`, async () => {
    // Asking and removing over and over, to dodge the 10-file limit.
    for (let i = 0; i < UPLOADS_PER_PERSON_PER_HOUR; i++) {
      const res = await ask(AMINA, {});
      expect(res.statusCode).toBe(200);
      await h.app.inject({ method: 'DELETE', url: `/files/${res.json().id}`, headers: AMINA });
    }
    const res = await ask(AMINA, {});
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('too_many_uploads');
  });

  it('the whole app: the daily limit pauses uploads and opens an incident', async () => {
    await setSetting(db, 'uploads_per_day_max', 10, null);
    for (let i = 0; i < 10; i++) {
      expect((await ask(i % 2 ? AMINA : BRIAN, { kind: i < 5 ? 'id_front' : 'selfie' })).statusCode).toBe(200);
    }
    const res = await ask(AMINA, { kind: 'id_back' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('uploads_paused');
    const [incident] = await db.select().from(incidents);
    expect(incident).toMatchObject({ kind: 'storage', title: 'Uploads paused: daily limit reached' });
  });

  it('the whole app: the storage limit counts what is stored and announced', async () => {
    await setSetting(db, 'storage_max_mb', 100, null);
    await db.insert(files).values({
      id: 'file_big', ownerId: 'p1', purpose: 'MECHANIC_DOCUMENT', kind: 'selfie', key: 'mechanic/p1/file_big',
      contentType: JPEG, declaredBytes: 100 * 1024 * 1024 - 100_000, bytes: 100 * 1024 * 1024 - 100_000,
      status: 'READY', createdAt: new Date(0), linkExpiresAt: new Date(0), updatedAt: new Date(0),
    });
    expect((await ask(AMINA, { bytes: 50_000 })).statusCode).toBe(200);
    const res = await ask(AMINA, { bytes: 200_000 });
    expect(res.json().error).toBe('uploads_paused');
  });

  it('housekeeping deletes abandoned uploads and catches a file swapped after confirming', async () => {
    const abandoned = (await ask(AMINA, {})).json();
    mem.upload(abandoned.uploadUrl, 1000, JPEG); // uploaded, never confirmed
    const { link } = await uploaded(AMINA, { kind: 'selfie' });
    // The same link used again, inside its 5 minutes, for something bigger.
    mem.upload(link.uploadUrl, 200 * 1024 * 1024, JPEG);

    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(await runFileUpkeep(db, mem.store, { now: later })).toEqual({ cleaned: 1, settled: 1 });
    const rows = await db.select().from(files);
    expect(rows.find(r => r.id === abandoned.id)).toMatchObject({ status: 'DELETED', statusReason: 'never_confirmed' });
    expect(rows.find(r => r.id === link.id)).toMatchObject({ status: 'REJECTED', statusReason: 'too_big' });
    expect(mem.objects.size).toBe(0);
  });

  it('staff see storage use against the limits', async () => {
    await uploaded(AMINA);
    expect(await h.staffOk('GET', '/files/usage')).toMatchObject({
      configured: true,
      files: 1,
      storedBytes: 300_000,
      last24h: { uploads: 1, rejected: 0 },
      limits: { storageMaxMb: 8000, uploadsPerDay: 2000 },
    });
  });
});

describe('without file storage', () => {
  it('answers not_configured instead of failing', async () => {
    const plain = adminHarness(db);
    const res = await plain.app.inject({ method: 'POST', url: '/files', headers: AMINA, payload: { purpose: 'MECHANIC_DOCUMENT', kind: 'id_front', contentType: JPEG, bytes: 10 } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('not_configured');
    await plain.app.close();
  });
});

describe('API rate limit', () => {
  it('limits each signed-in account per minute, never health checks', async () => {
    const app = buildApp({ db, requestsPerMinute: 3 });
    const get = (url: string, headers = {}) => app.inject({ method: 'GET', url, headers });
    for (let i = 0; i < 3; i++) {
      expect((await get('/files', AMINA)).statusCode).toBe(200);
    }
    const limited = await get('/files', AMINA);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    // Someone else has their own allowance.
    expect((await get('/files', BRIAN)).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await get('/health')).statusCode).toBe(200);
    }
    await app.close();
  });
});
