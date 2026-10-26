import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Caller } from '../auth';
import type { Database } from '../db/client';
import { files, jobs, providers, type FilePurpose } from '../db/schema';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  LimitError,
  NotFoundError,
} from '../errors';
import { newId } from '../ids';
import { reportIncident } from '../incidents';
import { getSetting } from '../settings';
import type { FileStore } from '../storage/files';
import {
  FILE_KINDS,
  MAX_ACTIVE,
  MAX_FILE_BYTES,
  PENDING_CLEANUP_MS,
  replacesPrevious,
  UPLOAD_LINK_SECONDS,
  UPLOADS_PER_PERSON_PER_HOUR,
} from './rules';

type FileRow = typeof files.$inferSelect;

export type UploadRequest = {
  purpose: FilePurpose;
  kind: string;
  jobId?: string;
  contentType: string;
  bytes: number;
};

const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const ACTIVE = ['PENDING', 'READY'] as const;

/** What the app is shown about a file: never its key or a link. */
export const publicFile = (row: FileRow) => ({
  id: row.id,
  purpose: row.purpose,
  kind: row.kind,
  jobId: row.jobId,
  contentType: row.contentType,
  bytes: row.bytes ?? row.declaredBytes,
  status: row.status,
  createdAt: row.createdAt,
});

/** The type without parameters ("image/jpeg; charset=…" → "image/jpeg"). */
const baseType = (type: string | null) => (type ?? '').split(';')[0].trim().toLowerCase();

/** Removes the bytes from R2, then records why. */
async function discard(
  db: Database,
  store: FileStore,
  row: FileRow,
  status: 'REJECTED' | 'DELETED',
  reason: string,
) {
  await store.delete(row.key);
  await db
    .update(files)
    .set({ status, statusReason: reason, updatedAt: new Date() })
    .where(eq(files.id, row.id));
}

/** Who may upload this, checked before any link is handed out. */
async function checkAllowed(db: Database, caller: Caller, input: UploadRequest) {
  const types = FILE_KINDS[input.purpose]?.[input.kind];
  if (!types) {
    throw new BadRequestError(`Unknown kind of file: ${input.kind}`);
  }
  const type = baseType(input.contentType);
  if (!types.includes(type)) {
    throw new BadRequestError(`This file must be one of: ${types.join(', ')}`);
  }
  if (input.bytes > MAX_FILE_BYTES) {
    throw new BadRequestError(`Files can be at most ${MAX_FILE_BYTES / MB} MB`);
  }

  if (input.purpose === 'MECHANIC_DOCUMENT') {
    if (input.jobId) {
      throw new BadRequestError('Mechanic documents are not tied to a job');
    }
    const [provider] = await db
      .select({ userId: providers.userId })
      .from(providers)
      .where(eq(providers.userId, caller.id));
    if (caller.role !== 'PROVIDER' || !provider) {
      throw new ForbiddenError('Only mechanics upload documents');
    }
  } else {
    if (!input.jobId) {
      throw new BadRequestError('Say which job the photo is for');
    }
    await disputeOf(db, caller, input.jobId);
  }
  return type;
}

/** A disputed job the caller is part of: the only place dispute photos go. */
async function disputeOf(db: Database, caller: Caller, jobId: string) {
  const [job] = await db
    .select({ status: jobs.status, customerId: jobs.customerId, providerId: jobs.providerId })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!job || (job.customerId !== caller.id && job.providerId !== caller.id)) {
    throw new NotFoundError('Job');
  }
  if (job.status !== 'DISPUTED') {
    throw new ConflictError('not_disputed', 'Photos can only be added while a job is in dispute');
  }
}

/**
 * The whole app's limits (settings uploads_per_day_max, storage_max_mb).
 * Reaching one pauses uploads for everyone and opens an incident, so a bug
 * or an attack shows up on the Engineering page instead of on the bill.
 */
async function checkAppLimits(db: Database, bytes: number, now: Date) {
  const [[{ today }], [{ stored }], perDay, maxMb] = await Promise.all([
    db
      .select({ today: sql<number>`count(*)::int` })
      .from(files)
      .where(gt(files.createdAt, new Date(now.getTime() - 24 * HOUR))),
    db
      .select({ stored: sql<number>`coalesce(sum(coalesce(${files.bytes}, ${files.declaredBytes})), 0)::bigint` })
      .from(files)
      .where(inArray(files.status, ACTIVE)),
    getSetting(db, 'uploads_per_day_max'),
    getSetting(db, 'storage_max_mb'),
  ]);
  const pause = async (title: string, detail: Record<string, unknown>) => {
    await reportIncident(db, { kind: 'storage', title, detail });
    throw new LimitError(503, 'uploads_paused', 'Uploads are paused for now. Please try again later.');
  };
  if (today >= perDay) {
    await pause('Uploads paused: daily limit reached', { uploadsLast24h: today, limit: perDay });
  }
  if (Number(stored) + bytes > maxMb * MB) {
    await pause('Uploads paused: storage limit reached', { storedBytes: Number(stored), limitMb: maxMb });
  }
}

/**
 * Step 1 of an upload: checks everything, records the file as PENDING and
 * returns a link for that one file, valid for UPLOAD_LINK_SECONDS.
 */
export async function requestUpload(
  db: Database,
  store: FileStore,
  caller: Caller,
  input: UploadRequest,
  now = new Date(),
) {
  const contentType = await checkAllowed(db, caller, input);
  await checkAppLimits(db, input.bytes, now);

  const id = newId('file');
  const prefix = input.purpose === 'MECHANIC_DOCUMENT' ? 'mechanic' : 'dispute';
  const key = `${prefix}/${caller.id}/${id}`;
  const linkExpiresAt = new Date(now.getTime() + UPLOAD_LINK_SECONDS * 1000);

  await db.transaction(async tx => {
    // One person's requests one at a time, so two at once can't both
    // squeeze under a limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`files:${caller.id}`}))`);
    const [{ lastHour }] = await tx
      .select({ lastHour: sql<number>`count(*)::int` })
      .from(files)
      .where(and(eq(files.ownerId, caller.id), gt(files.createdAt, new Date(now.getTime() - HOUR))));
    if (lastHour >= UPLOADS_PER_PERSON_PER_HOUR) {
      throw new LimitError(429, 'too_many_uploads', 'Too many uploads in the last hour. Please try again later.');
    }
    const [{ active }] = await tx
      .select({ active: sql<number>`count(*)::int` })
      .from(files)
      .where(
        and(
          eq(files.ownerId, caller.id),
          eq(files.purpose, input.purpose),
          inArray(files.status, ACTIVE),
          input.jobId ? eq(files.jobId, input.jobId) : undefined,
        ),
      );
    if (active >= MAX_ACTIVE[input.purpose]) {
      throw new ConflictError(
        'too_many_files',
        `You can have at most ${MAX_ACTIVE[input.purpose]} of these. Remove one first.`,
      );
    }
    await tx.insert(files).values({
      id,
      ownerId: caller.id,
      purpose: input.purpose,
      kind: input.kind,
      jobId: input.jobId ?? null,
      key,
      contentType,
      declaredBytes: input.bytes,
      status: 'PENDING',
      createdAt: now,
      linkExpiresAt,
      updatedAt: now,
    });
  });

  return {
    id,
    uploadUrl: await store.uploadUrl(key, UPLOAD_LINK_SECONDS),
    method: 'PUT' as const,
    // The app must send exactly this, or confirm rejects the file.
    headers: { 'content-type': contentType },
    expiresAt: linkExpiresAt,
  };
}

/** Problems with what actually arrived, or null if it's fine. */
function arrivedProblem(row: FileRow, seen: { bytes: number; contentType: string | null }) {
  if (seen.bytes > MAX_FILE_BYTES) {
    return 'too_big';
  }
  if (seen.bytes === 0) {
    return 'empty';
  }
  if (baseType(seen.contentType) !== row.contentType) {
    return 'wrong_type';
  }
  return null;
}

const PROBLEM_TEXT: Record<string, string> = {
  too_big: `The file is bigger than ${MAX_FILE_BYTES / MB} MB`,
  empty: 'The file is empty',
  wrong_type: 'The file is not the type that was announced',
};

/**
 * Step 2: the app says the upload finished. The server looks at what R2
 * really holds; a file that breaks the rules is deleted on the spot. A new
 * mechanic document replaces the previous one of the same kind.
 */
export async function confirmUpload(db: Database, store: FileStore, caller: Caller, id: string) {
  const [row] = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerId, caller.id)));
  if (!row) {
    throw new NotFoundError('File');
  }
  if (row.status === 'READY') {
    return publicFile(row);
  }
  if (row.status !== 'PENDING') {
    throw new ConflictError('not_pending', 'This upload was cancelled; start a new one');
  }
  const seen = await store.head(row.key);
  if (!seen) {
    throw new ConflictError('not_uploaded', "The file hasn't arrived yet: upload it, then confirm");
  }
  const problem = arrivedProblem(row, seen);
  if (problem) {
    await discard(db, store, row, 'REJECTED', problem);
    throw new BadRequestError(PROBLEM_TEXT[problem]);
  }

  const at = new Date();
  const [ready] = await db
    .update(files)
    .set({ status: 'READY', bytes: seen.bytes, confirmedAt: at, updatedAt: at })
    .where(and(eq(files.id, row.id), eq(files.status, 'PENDING')))
    .returning();
  if (replacesPrevious(row.purpose)) {
    const older = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.ownerId, row.ownerId),
          eq(files.purpose, row.purpose),
          eq(files.kind, row.kind),
          eq(files.status, 'READY'),
          ne(files.id, row.id),
        ),
      );
    for (const old of older) {
      await discard(db, store, old, 'DELETED', 'replaced');
    }
  }
  return publicFile(ready ?? row);
}

/** The caller's own files (details only: the app never gets links). */
export async function listOwnFiles(
  db: Database,
  caller: Caller,
  filter: { purpose?: FilePurpose; jobId?: string },
) {
  const rows = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.ownerId, caller.id),
        eq(files.status, 'READY'),
        filter.purpose ? eq(files.purpose, filter.purpose) : undefined,
        filter.jobId ? eq(files.jobId, filter.jobId) : undefined,
      ),
    )
    .orderBy(asc(files.createdAt));
  return rows.map(publicFile);
}

/**
 * The owner removes a file. Not once it's evidence for a decision: a
 * verified mechanic replaces documents instead, and dispute photos stay
 * once the dispute is decided.
 */
export async function deleteOwnFile(db: Database, store: FileStore, caller: Caller, id: string) {
  const [row] = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerId, caller.id)));
  if (!row || !(ACTIVE as readonly string[]).includes(row.status)) {
    throw new NotFoundError('File');
  }
  if (row.purpose === 'MECHANIC_DOCUMENT') {
    const [provider] = await db
      .select({ verification: providers.verification })
      .from(providers)
      .where(eq(providers.userId, caller.id));
    if (provider?.verification === 'VERIFIED') {
      throw new ConflictError('verified', 'Verified documents can be replaced, not removed');
    }
  } else if (row.jobId) {
    await disputeOf(db, caller, row.jobId);
  }
  await discard(db, store, row, 'DELETED', 'removed_by_owner');
  return { id, status: 'DELETED' as const };
}

/**
 * Housekeeping, every minute:
 * - uploads never confirmed are deleted after PENDING_CLEANUP_MS;
 * - each ready file is looked at once more after its link expired, so a
 *   second upload through the same link can't swap in something bigger.
 */
export async function runFileUpkeep(
  db: Database,
  store: FileStore,
  { now = new Date(), onError = (_err: unknown, _row: FileRow) => {} } = {},
) {
  let cleaned = 0;
  let settled = 0;
  const stale = await db
    .select()
    .from(files)
    .where(and(eq(files.status, 'PENDING'), lt(files.createdAt, new Date(now.getTime() - PENDING_CLEANUP_MS))))
    .limit(100);
  for (const row of stale) {
    try {
      await discard(db, store, row, 'DELETED', 'never_confirmed');
      cleaned++;
    } catch (err) {
      onError(err, row);
    }
  }

  const unsettled = await db
    .select()
    .from(files)
    .where(and(eq(files.status, 'READY'), isNull(files.settledAt), lt(files.linkExpiresAt, now)))
    .limit(100);
  for (const row of unsettled) {
    try {
      const seen = await store.head(row.key);
      const problem = seen ? arrivedProblem(row, seen) : 'missing';
      if (problem) {
        await discard(db, store, row, problem === 'missing' ? 'DELETED' : 'REJECTED', problem);
      } else {
        await db
          .update(files)
          .set({ bytes: seen!.bytes, settledAt: now, updatedAt: now })
          .where(eq(files.id, row.id));
      }
      settled++;
    } catch (err) {
      onError(err, row);
    }
  }
  return { cleaned, settled };
}

export function startFileUpkeep(
  db: Database,
  store: FileStore,
  { onError, everyMs = 60_000 }: { onError: (err: unknown) => void; everyMs?: number },
) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runFileUpkeep(db, store, {
        onError: (err, row) => {
          onError(err);
          reportIncident(db, {
            kind: 'storage',
            title: 'File housekeeping failed',
            detail: { fileId: row.id, message: (err as Error).message },
          });
        },
      });
    } catch (err) {
      onError(err);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}
