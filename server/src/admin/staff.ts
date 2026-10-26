import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database, Tx } from '../db/client';
import { staff, staffSessions, STAFF_ROLES, type StaffRole } from '../db/schema';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { newId } from '../ids';
import { ROLE_INFO, ROLE_PERMISSIONS } from './permissions';
import { reasonFrom, reasonSchema } from './reason';
import { audit, staffOf } from './session';

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', maxLength: 100 } },
} as const;

const reasonBody = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: { reason: reasonSchema },
} as const;

const roleSchema = { type: 'string', enum: STAFF_ROLES } as const;

/** Active owners other than `exceptId`; there must always be one left. */
async function otherActiveOwners(tx: Tx, exceptId: string) {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(staff)
    .where(and(eq(staff.role, 'OWNER'), eq(staff.status, 'ACTIVE'), ne(staff.id, exceptId)));
  return count;
}

/**
 * Security → Staff (docs/admin-portal.md §2, §5): who may sign in to the
 * console and with which role. Everything here needs staff.manage. Nobody
 * changes their own access (another owner does), and the last active owner
 * can't be demoted or disabled, so the console can't lock everyone out.
 */
export function registerAdminStaff(admin: FastifyInstance, db: Database) {
  admin.get('/staff', async request => {
    await staffOf(db, request, 'staff.manage');
    const members = await db
      .select({
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: staff.role,
        status: staff.status,
        googleLinked: sql<boolean>`${staff.googleSubject} is not null`,
        lastLoginAt: staff.lastLoginAt,
        createdAt: staff.createdAt,
      })
      .from(staff)
      .orderBy(asc(staff.createdAt));
    return {
      staff: members,
      roles: STAFF_ROLES.map(id => ({ id, ...ROLE_INFO[id], permissions: ROLE_PERMISSIONS[id] })),
    };
  });

  /** Lets an email sign in with Google; the account is bound at first sign-in. */
  admin.post<{ Body: { email: string; role: StaffRole; reason: string } }>(
    '/staff',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'role', 'reason'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            role: roleSchema,
            reason: reasonSchema,
          },
        },
      },
    },
    async request => {
      const me = await staffOf(db, request, 'staff.manage');
      const reason = reasonFrom(request.body.reason);
      const email = request.body.email.trim().toLowerCase();
      const { role } = request.body;
      return db.transaction(async tx => {
        const [existing] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.email, email));
        if (existing) {
          throw new ConflictError('staff_exists', 'This email is already on the staff list');
        }
        const at = new Date();
        const id = newId('staff');
        await tx.insert(staff).values({ id, email, role, status: 'ACTIVE', createdAt: at, updatedAt: at });
        await audit(tx, request, {
          staffId: me.id,
          action: 'staff.add',
          targetType: 'staff',
          targetId: id,
          after: { email, role },
          reason,
        });
        return { id, email, role, status: 'ACTIVE' };
      });
    },
  );

  /** Loads a colleague for a change, locked, refusing changes to yourself. */
  async function colleague(tx: Tx, id: string, meId: string) {
    if (id === meId) {
      throw new ForbiddenError("You can't change your own access; ask another owner");
    }
    const [member] = await tx.select().from(staff).where(eq(staff.id, id)).for('update');
    if (!member) {
      throw new NotFoundError('Staff member');
    }
    return member;
  }

  admin.put<{ Params: { id: string }; Body: { role: StaffRole; reason: string } }>(
    '/staff/:id/role',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'reason'],
          properties: { role: roleSchema, reason: reasonSchema },
        },
      },
    },
    async request => {
      const me = await staffOf(db, request, 'staff.manage');
      const reason = reasonFrom(request.body.reason);
      const { role } = request.body;
      return db.transaction(async tx => {
        const member = await colleague(tx, request.params.id, me.id);
        if (member.role === role) {
          throw new ConflictError('no_change', `Already ${ROLE_INFO[role].label}`);
        }
        if (member.role === 'OWNER' && (await otherActiveOwners(tx, member.id)) === 0) {
          throw new ConflictError('last_owner', 'Fundi-X needs at least one active owner');
        }
        await tx.update(staff).set({ role, updatedAt: new Date() }).where(eq(staff.id, member.id));
        await audit(tx, request, {
          staffId: me.id,
          action: 'staff.role_change',
          targetType: 'staff',
          targetId: member.id,
          before: { role: member.role },
          after: { role },
          reason,
        });
        return { id: member.id, role };
      });
    },
  );

  /** Disabling also ends their open sessions, so it takes effect at once. */
  for (const [path, to] of [
    ['disable', 'DISABLED'],
    ['enable', 'ACTIVE'],
  ] as const) {
    admin.post<{ Params: { id: string }; Body: { reason: string } }>(
      `/staff/:id/${path}`,
      { schema: { params: idParams, body: reasonBody } },
      async request => {
        const me = await staffOf(db, request, 'staff.manage');
        const reason = reasonFrom(request.body.reason);
        return db.transaction(async tx => {
          const member = await colleague(tx, request.params.id, me.id);
          if (member.status === to) {
            throw new ConflictError('no_change', `Already ${to.toLowerCase()}`);
          }
          if (to === 'DISABLED' && member.role === 'OWNER' && (await otherActiveOwners(tx, member.id)) === 0) {
            throw new ConflictError('last_owner', 'Fundi-X needs at least one active owner');
          }
          const at = new Date();
          await tx.update(staff).set({ status: to, updatedAt: at }).where(eq(staff.id, member.id));
          if (to === 'DISABLED') {
            await tx
              .update(staffSessions)
              .set({ revokedAt: at })
              .where(and(eq(staffSessions.staffId, member.id), isNull(staffSessions.revokedAt)));
          }
          await audit(tx, request, {
            staffId: me.id,
            action: `staff.${path}`,
            targetType: 'staff',
            targetId: member.id,
            before: { status: member.status },
            after: { status: to },
            reason,
          });
          return { id: member.id, status: to };
        });
      },
    );
  }
}
