import { createHash, randomBytes } from 'node:crypto';

/**
 * Session tokens for staff and app sessions alike: 32 random bytes handed
 * to the browser or phone, of which only the SHA-256 hash is stored, so a
 * leaked database can't be used to sign in.
 */
export const newToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');
