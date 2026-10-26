import { AwsClient } from 'aws4fetch';

/**
 * Where uploaded files live: mechanic documents and photos, dispute
 * evidence (docs/files.md). Cloudflare R2, spoken to in the S3 format, so
 * any S3-compatible store works by changing server/.env only.
 *
 * Buckets are private. Phones and the admin website never get keys: they
 * get a link for one file that stops working after a few minutes.
 */
export type FileStore = {
  name: 'r2';
  bucket: string;
  /** A link the phone PUTs one file to. */
  uploadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** A link a browser can open (e.g. in an <img>) until it expires. */
  downloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Size and type of a stored file, or null if there is none. */
  head(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** Upload and viewing links last 5 minutes unless asked otherwise. */
const LINK_SECONDS = 5 * 60;

/**
 * R2 settings from server/.env (or the host's environment). None set:
 * no file storage. Some set: a mistake worth stopping for.
 */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv): R2Config | null {
  const required = {
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: env.R2_BUCKET,
  };
  if (Object.values(required).every(v => !v?.trim())) {
    return null;
  }
  const missing = Object.entries(required).filter(([, v]) => !v?.trim()).map(([k]) => k);
  if (missing.length) {
    throw new Error(`File storage is partly configured: set ${missing.join(', ')} in server/.env`);
  }
  return {
    accountId: required.R2_ACCOUNT_ID!.trim(),
    accessKeyId: required.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: required.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: required.R2_BUCKET!.trim(),
  };
}

export function r2FileStore(config: R2Config): FileStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  const objectUrl = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

  async function presign(method: 'GET' | 'PUT', key: string, seconds: number) {
    const url = new URL(objectUrl(key));
    url.searchParams.set('X-Amz-Expires', String(seconds));
    const signed = await client.sign(url.toString(), { method, aws: { signQuery: true } });
    return signed.url;
  }

  async function send(method: string, key: string, init: RequestInit = {}) {
    const res = await client.fetch(objectUrl(key), { method, ...init });
    // A missing file is an answer for HEAD and DELETE; for a save it means
    // the bucket itself is missing.
    const missingIsFine = method === 'HEAD' || method === 'DELETE';
    if (!res.ok && !(missingIsFine && res.status === 404)) {
      throw new Error(`File storage ${method} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    return res;
  }

  return {
    name: 'r2',
    bucket: config.bucket,
    uploadUrl: (key, seconds = LINK_SECONDS) => presign('PUT', key, seconds),
    downloadUrl: (key, seconds = LINK_SECONDS) => presign('GET', key, seconds),
    async head(key) {
      const res = await send('HEAD', key);
      if (res.status === 404) {
        return null;
      }
      return {
        bytes: Number(res.headers.get('content-length') ?? 0),
        contentType: res.headers.get('content-type'),
      };
    },
    async put(key, body, contentType) {
      await send('PUT', key, { body, headers: { 'content-type': contentType } });
    },
    async delete(key) {
      await send('DELETE', key);
    },
  };
}
