import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import { files, type FilePurpose } from '../db/schema';
import { NotConfiguredError, NotFoundError } from '../errors';
import { MAX_FILE_BYTES, UPLOADS_PER_PERSON_PER_HOUR, VIEW_LINK_SECONDS } from '../files/rules';
import { getSetting } from '../settings';
import type { FileStore } from '../storage/files';
import type { Permission } from './permissions';
import { audit, staffOf } from './session';

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', maxLength: 100 } },
} as const;

/** Mechanic documents are about people; dispute photos are about jobs. */
const viewPermission = (purpose: FilePurpose): Permission =>
  purpose === 'MECHANIC_DOCUMENT' ? 'users.view' : 'jobs.view';

/**
 * Uploaded files for staff (docs/files.md §2): lists, a viewing link that
 * works for a few minutes (every one in the audit log), and the storage
 * numbers behind the upload limits.
 */
export function registerAdminFiles(admin: FastifyInstance, db: Database, store: FileStore | null) {
  admin.get<{ Querystring: { ownerId?: string; jobId?: string } }>(
    '/files',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ownerId: { type: 'string', maxLength: 100 },
            jobId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async request => {
      const { ownerId, jobId } = request.query;
      await staffOf(db, request, jobId ? 'jobs.view' : 'users.view');
      return db
        .select({
          id: files.id,
          ownerId: files.ownerId,
          purpose: files.purpose,
          kind: files.kind,
          jobId: files.jobId,
          contentType: files.contentType,
          bytes: files.bytes,
          status: files.status,
          statusReason: files.statusReason,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(
          and(
            ownerId ? eq(files.ownerId, ownerId) : undefined,
            jobId ? eq(files.jobId, jobId) : undefined,
            // A person's page shows their documents; a job's, its photos.
            !jobId ? eq(files.purpose, 'MECHANIC_DOCUMENT') : undefined,
            inArray(files.status, ['READY', 'REJECTED']),
          ),
        )
        .orderBy(desc(files.createdAt))
        .limit(100);
    },
  );

  /** A POST, not a GET: it writes to the audit log, and only the portal may ask. */
  admin.post<{ Params: { id: string } }>('/files/:id/link', { schema: { params: idParams } }, async request => {
    if (!store) {
      throw new NotConfiguredError('File storage is not set up on this server');
    }
    const [row] = await db.select().from(files).where(eq(files.id, request.params.id));
    if (!row || row.status !== 'READY') {
      throw new NotFoundError('File');
    }
    const me = await staffOf(db, request, viewPermission(row.purpose));
    await audit(db, request, {
      staffId: me.id,
      action: 'file.view',
      targetType: 'file',
      targetId: row.id,
      after: { ownerId: row.ownerId, purpose: row.purpose, kind: row.kind, jobId: row.jobId },
    });
    return {
      url: await store.downloadUrl(row.key, VIEW_LINK_SECONDS),
      contentType: row.contentType,
      expiresAt: new Date(Date.now() + VIEW_LINK_SECONDS * 1000),
    };
  });

  /** What's stored and how close the app is to its upload limits. */
  admin.get('/files/usage', async request => {
    await staffOf(db, request, 'logs.view');
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [[stored], [today], perDay, maxMb] = await Promise.all([
      db
        .select({
          files: sql<number>`count(*) filter (where ${files.status} = 'READY')::int`,
          pending: sql<number>`count(*) filter (where ${files.status} = 'PENDING')::int`,
          bytes: sql<number>`coalesce(sum(coalesce(${files.bytes}, ${files.declaredBytes})), 0)::bigint`,
        })
        .from(files)
        .where(inArray(files.status, ['PENDING', 'READY'])),
      db
        .select({
          uploads: sql<number>`count(*)::int`,
          rejected: sql<number>`count(*) filter (where ${files.status} = 'REJECTED')::int`,
        })
        .from(files)
        .where(gt(files.createdAt, dayAgo)),
      getSetting(db, 'uploads_per_day_max'),
      getSetting(db, 'storage_max_mb'),
    ]);
    return {
      configured: !!store,
      bucket: store?.bucket ?? null,
      files: stored.files,
      pending: stored.pending,
      storedBytes: Number(stored.bytes),
      last24h: { uploads: today.uploads, rejected: today.rejected },
      limits: {
        storageMaxMb: maxMb,
        uploadsPerDay: perDay,
        perPersonPerHour: UPLOADS_PER_PERSON_PER_HOUR,
        maxFileBytes: MAX_FILE_BYTES,
      },
    };
  });
}
