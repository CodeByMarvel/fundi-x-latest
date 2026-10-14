import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database, Tx } from '../db/client';
import { appSessions, users } from '../db/schema';
import { hashToken, newToken } from '../tokens';

/** A session lasts 60 days from its last use. */
export const APP_SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** How often "last used" is written: not on every request. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export async function createAppSession(
  tx: Tx,
  userId: string,
  method: 'google' | 'apple',
  request: FastifyRequest,
  at: Date,
) {
  const token = newToken();
  const expiresAt = new Date(at.getTime() + APP_SESSION_TTL_MS);
  await tx.insert(appSessions).values({
    tokenHash: hashToken(token),
    userId,
    method,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    createdAt: at,
    lastUsedAt: at,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * The account behind a session token, or null if the token is unknown,
 * revoked or expired. Using a session pushes its expiry forward (at most
 * once an hour, to keep requests cheap).
 */
export async function accountForToken(db: Database, token: string) {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      userId: users.id,
      role: users.role,
      status: users.status,
      expiresAt: appSessions.expiresAt,
      lastUsedAt: appSessions.lastUsedAt,
      revokedAt: appSessions.revokedAt,
    })
    .from(appSessions)
    .innerJoin(users, eq(users.id, appSessions.userId))
    .where(eq(appSessions.tokenHash, tokenHash));
  const now = new Date();
  if (!row || row.revokedAt || row.expiresAt <= now) {
    return null;
  }
  if (now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db
      .update(appSessions)
      .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + APP_SESSION_TTL_MS) })
      .where(eq(appSessions.tokenHash, tokenHash));
  }
  return { id: row.userId, role: row.role, status: row.status };
}

export async function revokeAppSession(db: Database, token: string) {
  await db
    .update(appSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(appSessions.tokenHash, hashToken(token)), isNull(appSessions.revokedAt)));
}

/** Ends every session of an account (deletion; later: "sign out everywhere"). */
export async function revokeAllAppSessions(tx: Tx | Database, userId: string) {
  await tx
    .update(appSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(appSessions.userId, userId), isNull(appSessions.revokedAt)));
}
