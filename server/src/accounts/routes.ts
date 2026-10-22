import { and, eq, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TRANSITIONS, isTerminalStatus } from '../../../src/domain/jobs/transitions';
import type { JobStatus } from '../../../src/domain/jobs/types';
import type { ProviderType } from '../../../src/domain/providers/types';
import type { GoogleVerifier } from '../admin/google';
import { callerOf, type Caller } from '../auth';
import type { Database } from '../db/client';
import { jobs, providers, users, type UserRole } from '../db/schema';
import { BadRequestError, ConflictError, ForbiddenError } from '../errors';
import { newId } from '../ids';
import type { AppleVerifier } from './apple';
import { forgetPlaces } from './places';
import { forgetVehicles } from './vehicles';
import { normalizeKenyanPhone } from './phone';
import { createAppSession, revokeAllAppSessions, revokeAppSession } from './sessions';

export type AccountsConfig = {
  verifyGoogle: GoogleVerifier;
  verifyApple: AppleVerifier;
  /** Given to the app's Google button (public by design). */
  googleClientId: string | null;
  appleEnabled: boolean;
};

const ROLES: Record<'customer' | 'provider', UserRole> = {
  customer: 'CUSTOMER',
  provider: 'PROVIDER',
};

const FINISHED = (Object.keys(TRANSITIONS) as JobStatus[]).filter(isTerminalStatus);

type UserRow = typeof users.$inferSelect;

/**
 * What the app needs to know about the signed-in account, including the
 * next thing it must ask for before the account can be used.
 */
async function accountView(db: Database, user: UserRow) {
  const [provider] =
    user.role === 'PROVIDER'
      ? await db.select().from(providers).where(eq(providers.userId, user.id))
      : [];
  const nextStep = !user.phone
    ? 'add_phone'
    : user.role === 'PROVIDER' && !provider
      ? 'provider_profile'
      : null;
  return {
    id: user.id,
    role: user.role === 'CUSTOMER' ? 'customer' : 'provider',
    name: user.name,
    email: user.email,
    phone: user.phone,
    phoneVerified: !!user.phoneVerifiedAt,
    provider: provider
      ? {
          type: provider.type,
          businessName: provider.businessName,
          specialty: provider.specialty,
          verification: provider.verification,
          // Shown to the mechanic, e.g. why the profile was rejected.
          verificationNote: provider.verificationNote,
        }
      : null,
    nextStep,
  };
}

async function userById(db: Database, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

/** The caller as a full row (they passed the auth hook, so they exist). */
async function me(db: Database, request: FastifyRequest): Promise<{ caller: Caller; user: UserRow }> {
  const caller = callerOf(request);
  return { caller, user: await userById(db, caller.id) };
}

const roleBody = { enum: ['customer', 'provider'] } as const;

/**
 * Sign-in and the signed-in account (docs: "Authentication", option A).
 * Google or Apple proves who the person is; this server decides what they
 * may do, so role, suspension and mechanic verification stay ours.
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  db: Database,
  config: AccountsConfig & { signInPerMinute: number },
) {
  const signInLimit = {
    rateLimit: { max: config.signInPerMinute, timeWindow: '1 minute' },
  };

  /**
   * Finds the account for this Google or Apple identity and role, or
   * creates it, then starts a session.
   */
  async function signIn(
    request: FastifyRequest,
    method: 'google' | 'apple',
    identity: { subject: string; email?: string; name?: string },
    roleName: 'customer' | 'provider',
  ) {
    const role = ROLES[roleName];
    const subjectColumn = method === 'google' ? users.googleSubject : users.appleSubject;
    const find = async () =>
      (
        await db
          .select()
          .from(users)
          .where(and(eq(subjectColumn, identity.subject), eq(users.role, role)))
      )[0];

    let user = await find();
    const at = new Date();
    if (!user) {
      const name =
        identity.name?.trim() || identity.email?.split('@')[0] || 'Fundi-X user';
      // Two first sign-ins at once: the second insert is skipped by the
      // unique index and both read the same new row.
      await db
        .insert(users)
        .values({
          id: newId('usr'),
          name,
          email: identity.email ?? null,
          role,
          status: 'ACTIVE',
          ...(method === 'google'
            ? { googleSubject: identity.subject }
            : { appleSubject: identity.subject }),
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing();
      user = await find();
    } else if (identity.email && identity.email !== user.email) {
      await db.update(users).set({ email: identity.email, updatedAt: at }).where(eq(users.id, user.id));
      user = { ...user, email: identity.email };
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenError('This account is suspended');
    }
    const session = await db.transaction(tx => createAppSession(tx, user.id, method, request, at));
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      account: await accountView(db, user),
    };
  }

  app.post<{ Body: { credential: string; role: 'customer' | 'provider' } }>(
    '/auth/google',
    {
      config: signInLimit,
      schema: {
        body: {
          type: 'object',
          required: ['credential', 'role'],
          additionalProperties: false,
          properties: { credential: { type: 'string', minLength: 1, maxLength: 4096 }, role: roleBody },
        },
      },
    },
    async request => {
      const identity = await config.verifyGoogle(request.body.credential);
      return signIn(request, 'google', identity, request.body.role);
    },
  );

  app.post<{ Body: { identityToken: string; role: 'customer' | 'provider'; name?: string } }>(
    '/auth/apple',
    {
      config: signInLimit,
      schema: {
        body: {
          type: 'object',
          required: ['identityToken', 'role'],
          additionalProperties: false,
          properties: {
            identityToken: { type: 'string', minLength: 1, maxLength: 4096 },
            role: roleBody,
            // Apple gives the name to the app once, on the first sign-in only.
            name: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async request => {
      const identity = await config.verifyApple(request.body.identityToken);
      return signIn(request, 'apple', { ...identity, name: request.body.name }, request.body.role);
    },
  );

  /**
   * What the sign-in screen needs, so the app holds no settings of its own
   * beyond the server's address.
   */
  app.get('/auth/config', async () => ({
    googleClientId: config.googleClientId,
    appleEnabled: config.appleEnabled,
  }));

  app.post('/auth/sign-out', async request => {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme === 'Bearer' && token) {
      await revokeAppSession(db, token);
    }
    return { ok: true };
  });

  app.get('/me', async request => {
    const { user } = await me(db, request);
    return accountView(db, user);
  });

  /** The M-Pesa number. Changing it means it must be proven again. */
  app.put<{ Body: { phone: string } }>(
    '/me/phone',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone'],
          additionalProperties: false,
          properties: { phone: { type: 'string', maxLength: 20 } },
        },
      },
    },
    async request => {
      const { user } = await me(db, request);
      const phone = normalizeKenyanPhone(request.body.phone);
      if (!phone) {
        throw new BadRequestError('Enter a Kenyan mobile number, e.g. 0712 345 678');
      }
      if (phone !== user.phone) {
        const [taken] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.phone, phone), eq(users.role, user.role)));
        if (taken) {
          throw new ConflictError('phone_in_use', 'This number is already used by another account');
        }
        await db
          .update(users)
          .set({ phone, phoneVerifiedAt: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }
      return accountView(db, (await userById(db, user.id))!);
    },
  );

  /**
   * A mechanic's or garage's profile. New profiles wait for Fundi-X to
   * verify them (admin portal) before they're offered any job.
   */
  app.put<{ Body: { type: ProviderType; businessName?: string; specialty: string } }>(
    '/me/provider',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'specialty'],
          additionalProperties: false,
          properties: {
            type: { enum: ['mechanic', 'garage'] },
            businessName: { type: 'string', maxLength: 100 },
            specialty: { type: 'string', minLength: 2, maxLength: 100 },
          },
        },
      },
    },
    async request => {
      const { user } = await me(db, request);
      if (user.role !== 'PROVIDER') {
        throw new ForbiddenError('Only mechanic accounts have a provider profile');
      }
      if (!user.phone) {
        throw new ConflictError('phone_required', 'Add your M-Pesa number first');
      }
      const { type, specialty } = request.body;
      const businessName = request.body.businessName?.trim() || null;
      const at = new Date();
      await db
        .insert(providers)
        .values({
          userId: user.id,
          type,
          businessName,
          specialty: specialty.trim(),
          payoutPhone: user.phone,
          verification: 'PENDING',
          createdAt: at,
          updatedAt: at,
        })
        // Editing keeps the verification decision; only Fundi-X changes it.
        // A rejected profile that's been fixed goes back in the queue.
        .onConflictDoUpdate({
          target: providers.userId,
          set: {
            type,
            businessName,
            specialty: specialty.trim(),
            verification: sql`case when ${providers.verification} = 'REJECTED' then 'PENDING' else ${providers.verification} end`,
            updatedAt: at,
          },
        });
      return accountView(db, user);
    },
  );

  /**
   * Deletes the account (both app stores require this). Personal details
   * are wiped and every session ends; the row stays so past jobs still add
   * up. Payment records keep the number they were paid from, as financial
   * records must be kept. Refused while a job is still open, because money
   * may be in escrow for it.
   */
  app.delete('/me', async request => {
    const { user } = await me(db, request);
    const [open] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          or(eq(jobs.customerId, user.id), eq(jobs.providerId, user.id)),
          notInArray(jobs.status, FINISHED),
        ),
      )
      .limit(1);
    if (open) {
      throw new ConflictError('active_jobs', 'Finish or cancel your open jobs before deleting your account');
    }
    await db.transaction(async tx => {
      await tx
        .update(users)
        .set({
          name: 'Deleted user',
          email: null,
          phone: null,
          phoneVerifiedAt: null,
          googleSubject: null,
          appleSubject: null,
          status: 'DELETED',
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await tx
        .update(providers)
        .set({ online: false, lat: null, lng: null, h3Cell: null, locationAt: null })
        .where(eq(providers.userId, user.id));
      await revokeAllAppSessions(tx, user.id);
      await forgetPlaces(tx, user.id);
      await forgetVehicles(tx, user.id, new Date());
    });
    return { ok: true };
  });
}
