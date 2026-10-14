import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database, Tx } from '../db/client';
import { auditLog, staff, staffSessions, type StaffRole } from '../db/schema';
import { ForbiddenError, UnauthenticatedError } from '../errors';
import { newId } from '../ids';
import { hashToken as hash, newToken } from '../tokens';
import { can, type Permission } from './permissions';

export const SESSION_COOKIE = 'fx_admin';
/** A working day. After that, sign in with Google again. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type StaffCaller = {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
};

/** Starts a session; returns the token for the cookie (never stored). */
export async function createSession(
  tx: Tx,
  staffId: string,
  request: FastifyRequest,
  at: Date,
) {
  const token = newToken();
  await tx.insert(staffSessions).values({
    tokenHash: hash(token),
    staffId,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    createdAt: at,
    expiresAt: new Date(at.getTime() + SESSION_TTL_MS),
  });
  return token;
}

/** Ends the session in the cookie, if there is one. */
export async function revokeSession(db: Database, token: string | undefined) {
  if (!token) {
    return null;
  }
  const [row] = await db
    .update(staffSessions)
    .set({ revokedAt: new Date() })
    .where(eq(staffSessions.tokenHash, hash(token)))
    .returning({ staffId: staffSessions.staffId });
  return row?.staffId ?? null;
}

/**
 * The staff member behind this request, checked against the database on
 * every call: a disabled account or a revoked session stops working at
 * once, not when the cookie expires. With `permission`, also refuses
 * anyone whose role doesn't include it.
 */
export async function staffOf(
  db: Database,
  request: FastifyRequest,
  permission?: Permission,
): Promise<StaffCaller> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    throw new UnauthenticatedError();
  }
  const [row] = await db
    .select({
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      status: staff.status,
      expiresAt: staffSessions.expiresAt,
      revokedAt: staffSessions.revokedAt,
    })
    .from(staffSessions)
    .innerJoin(staff, eq(staff.id, staffSessions.staffId))
    .where(eq(staffSessions.tokenHash, hash(token)));
  if (!row || row.revokedAt || row.expiresAt <= new Date()) {
    throw new UnauthenticatedError();
  }
  if (row.status !== 'ACTIVE') {
    throw new ForbiddenError('This staff account is disabled');
  }
  if (permission && !can(row.role, permission)) {
    throw new ForbiddenError(`Your role can't do this (${permission})`);
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** One line in the audit log, tied to the request that caused it. */
export async function audit(
  db: Database | Tx,
  request: FastifyRequest,
  entry: {
    staffId: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
) {
  await db.insert(auditLog).values({
    id: newId('aud'),
    staffId: entry.staffId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip: request.ip,
    requestId: request.id,
    createdAt: new Date(),
  });
}
