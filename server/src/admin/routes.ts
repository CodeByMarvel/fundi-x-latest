import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client';
import { auditLog, settings, staff } from '../db/schema';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors';
import {
  getSetting,
  isSettingKey,
  setSetting,
  SETTING_DEFAULTS,
  settingProblem,
  type SettingKey,
} from '../settings';
import type { GoogleIdentity, GoogleVerifier } from './google';
import { ROLE_PERMISSIONS } from './permissions';
import {
  audit,
  createSession,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  staffOf,
} from './session';

export type AdminConfig = {
  verifyGoogle: GoogleVerifier;
  /** Shown to the sign-in page (public by design: browsers see it anyway). */
  googleClientId: string | null;
  /**
   * The admin website's address, e.g. https://admin.fundix.co.ke. Requests
   * that change something are refused unless the browser says they came
   * from there, so another site can't act with your session.
   */
  origin: string;
  /** Send the session cookie over HTTPS only. Off only on a laptop. */
  secureCookie: boolean;
  /**
   * DEVELOPMENT ONLY: a one-click "sign in as the owner" without Google.
   * Answers only requests from this computer, and index.ts never turns it
   * on in production.
   */
  devSignIn: boolean;
};

/** This computer: IPv4, IPv6, and IPv4 written as IPv6. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const NOT_STAFF = 'This Google account is not allowed into the admin console';

/**
 * The admin console's API, all under /admin. Each endpoint asks staffOf()
 * for the permission it needs; the dev x-dev-user identities used by the
 * phone app mean nothing here.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  db: Database,
  config: AdminConfig,
) {
  app.register(
    async admin => {
      admin.addHook('onRequest', async request => {
        const changesSomething = !['GET', 'HEAD', 'OPTIONS'].includes(
          request.method,
        );
        if (changesSomething && request.headers.origin !== config.origin) {
          throw new ForbiddenError('Request did not come from the admin console');
        }
      });

      /**
       * What the sign-in page needs before anyone is signed in. Served from
       * here so the website has no settings of its own to keep in sync.
       */
      admin.get('/config', async () => ({
        googleClientId: config.googleClientId,
        devSignIn: config.devSignIn,
      }));

      /** Records the sign-in, starts a session and hands the browser its cookie. */
      async function signIn(
        request: FastifyRequest,
        reply: FastifyReply,
        member: typeof staff.$inferSelect,
        method: 'google' | 'dev',
        google?: GoogleIdentity,
      ) {
        const at = new Date();
        const token = await db.transaction(async tx => {
          await tx
            .update(staff)
            .set({
              ...(google && {
                googleSubject: google.subject,
                name: member.name ?? google.name ?? null,
              }),
              lastLoginAt: at,
              updatedAt: at,
            })
            .where(eq(staff.id, member.id));
          await audit(tx, request, {
            staffId: member.id,
            action: 'staff.sign_in',
            after: { method },
          });
          return createSession(tx, member.id, request, at);
        });
        reply.setCookie(SESSION_COOKIE, token, {
          path: '/admin',
          httpOnly: true, // page scripts can't read it, so injected code can't steal it
          sameSite: 'strict',
          secure: config.secureCookie,
          maxAge: SESSION_TTL_MS / 1000,
        });
        return {
          id: member.id,
          email: member.email,
          name: member.name,
          role: member.role,
          permissions: ROLE_PERMISSIONS[member.role],
        };
      }

      /** DEVELOPMENT ONLY: sign in as the owner, from this computer. */
      admin.post('/auth/dev', async (request, reply) => {
        if (!config.devSignIn) {
          throw new NotFoundError('Route');
        }
        // The server listens on the Wi-Fi too (for phones); only this
        // computer may use the shortcut.
        if (!LOOPBACK.has(request.ip)) {
          throw new ForbiddenError('Development sign-in only works on this computer');
        }
        const [owner] = await db
          .select()
          .from(staff)
          .where(and(eq(staff.role, 'OWNER'), eq(staff.status, 'ACTIVE')))
          .orderBy(staff.createdAt)
          .limit(1);
        if (!owner) {
          throw new NotFoundError('Owner account (set OWNER_EMAIL in server/.env)');
        }
        return signIn(request, reply, owner, 'dev');
      });

      /** The admin website posts the Google credential here to sign in. */
      admin.post<{ Body: { credential: string } }>(
        '/auth/google',
        {
          schema: {
            body: {
              type: 'object',
              required: ['credential'],
              additionalProperties: false,
              properties: { credential: { type: 'string', minLength: 1, maxLength: 4096 } },
            },
          },
        },
        async (request, reply) => {
          const identity = await config.verifyGoogle(request.body.credential);
          const email = identity.email.toLowerCase();
          const [member] = await db.select().from(staff).where(eq(staff.email, email));

          // Recorded before refusing: repeated denied attempts are worth seeing.
          const deny = async (reason: string) => {
            await audit(db, request, {
              staffId: member?.id ?? null,
              action: 'staff.sign_in_denied',
              after: { email, reason },
            });
            return new ForbiddenError(NOT_STAFF);
          };
          if (!member) {
            throw await deny('not_staff');
          }
          if (member.status !== 'ACTIVE') {
            throw await deny('disabled');
          }
          if (member.googleSubject && member.googleSubject !== identity.subject) {
            throw await deny('google_account_mismatch');
          }

          return signIn(request, reply, member, 'google', identity);
        },
      );

      admin.post('/auth/sign-out', async (request, reply) => {
        const staffId = await revokeSession(db, request.cookies[SESSION_COOKIE]);
        if (staffId) {
          await audit(db, request, { staffId, action: 'staff.sign_out' });
        }
        reply.clearCookie(SESSION_COOKIE, { path: '/admin' });
        return { ok: true };
      });

      /** Who's signed in, and what the page should let them do. */
      admin.get('/me', async request => {
        const me = await staffOf(db, request);
        return { ...me, permissions: ROLE_PERMISSIONS[me.role] };
      });

      admin.get('/settings', async request => {
        await staffOf(db, request, 'settings.edit');
        const saved = await db.select().from(settings);
        return (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map(key => {
          const row = saved.find(s => s.key === key);
          return {
            key,
            value: row?.value ?? SETTING_DEFAULTS[key],
            default: SETTING_DEFAULTS[key],
            updatedBy: row?.updatedBy ?? null,
            updatedAt: row?.updatedAt ?? null,
          };
        });
      });

      admin.put<{ Params: { key: string }; Body: { value: unknown } }>(
        '/settings/:key',
        {
          schema: {
            body: {
              type: 'object',
              required: ['value'],
              additionalProperties: false,
              properties: { value: {} },
            },
          },
        },
        async request => {
          const me = await staffOf(db, request, 'settings.edit');
          const { key } = request.params;
          if (!isSettingKey(key)) {
            throw new NotFoundError('Setting');
          }
          const problem = settingProblem(key, request.body.value);
          if (problem) {
            throw new BadRequestError(problem);
          }
          const value = request.body.value as (typeof SETTING_DEFAULTS)[typeof key];
          await db.transaction(async tx => {
            const before = await getSetting(tx, key);
            await setSetting(tx, key, value, me.id);
            await audit(tx, request, {
              staffId: me.id,
              action: 'settings.update',
              targetType: 'setting',
              targetId: key,
              before,
              after: value,
            });
          });
          return { key, value };
        },
      );

      /** Most recent first. `before` (an ISO time) pages further back. */
      admin.get<{ Querystring: { before?: string; limit?: number } }>(
        '/audit',
        {
          schema: {
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                before: { type: 'string', format: 'date-time' },
                limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
              },
            },
          },
        },
        async request => {
          await staffOf(db, request, 'logs.view');
          const { before, limit = 50 } = request.query;
          return db
            .select({
              ...getTableColumns(auditLog),
              staffEmail: staff.email,
            })
            .from(auditLog)
            .leftJoin(staff, eq(staff.id, auditLog.staffId))
            .where(before ? sql`${auditLog.createdAt} < ${new Date(before)}` : undefined)
            .orderBy(desc(auditLog.createdAt))
            .limit(limit);
        },
      );
    },
    { prefix: '/admin' },
  );
}
