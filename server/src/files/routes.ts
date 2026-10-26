import type { FastifyInstance } from 'fastify';
import { callerOf } from '../auth';
import type { Database } from '../db/client';
import type { FilePurpose } from '../db/schema';
import { NotConfiguredError } from '../errors';
import type { FileStore } from '../storage/files';
import { confirmUpload, deleteOwnFile, listOwnFiles, requestUpload, type UploadRequest } from './service';
import { MAX_FILE_BYTES } from './rules';

const PURPOSES = ['MECHANIC_DOCUMENT', 'DISPUTE_PHOTO'] as const;

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', maxLength: 100 } },
} as const;

/**
 * Uploads from the app (docs/files.md): ask for a link, PUT the file to it,
 * then confirm. Answers 503 not_configured when file storage is off.
 */
export function registerFileRoutes(app: FastifyInstance, db: Database, store: FileStore | null) {
  const storeOrFail = () => {
    if (!store) {
      throw new NotConfiguredError('File uploads are not set up on this server');
    }
    return store;
  };

  app.post<{ Body: UploadRequest }>(
    '/files',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'kind', 'contentType', 'bytes'],
          properties: {
            purpose: { type: 'string', enum: PURPOSES },
            kind: { type: 'string', maxLength: 40 },
            jobId: { type: 'string', maxLength: 100 },
            contentType: { type: 'string', maxLength: 100 },
            bytes: { type: 'integer', minimum: 1, maximum: MAX_FILE_BYTES },
          },
        },
      },
    },
    async request => requestUpload(db, storeOrFail(), callerOf(request), request.body),
  );

  app.post<{ Params: { id: string } }>(
    '/files/:id/confirm',
    { schema: { params: idParams } },
    async request => confirmUpload(db, storeOrFail(), callerOf(request), request.params.id),
  );

  app.get<{ Querystring: { purpose?: FilePurpose; jobId?: string } }>(
    '/files',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            purpose: { type: 'string', enum: PURPOSES },
            jobId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async request => listOwnFiles(db, callerOf(request), request.query),
  );

  app.delete<{ Params: { id: string } }>(
    '/files/:id',
    { schema: { params: idParams } },
    async request => deleteOwnFile(db, storeOrFail(), callerOf(request), request.params.id),
  );
}
