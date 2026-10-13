import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditLog, staff } from '../db/schema';
import { newId } from '../ids';

/**
 * The first staff account can't be added from the admin console (nobody
 * can sign in yet), so it comes from configuration: OWNER_EMAIL in
 * server/.env locally, the host's environment settings in production.
 *
 * It's used ONCE, while there are no staff at all. After that the staff
 * table is the only source of truth, so editing OWNER_EMAIL can never
 * quietly add a second owner; staff changes go through the console.
 */
export async function ensureOwner(
  db: Database,
  ownerEmail: string | undefined,
): Promise<'created' | 'exists' | 'missing'> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staff);
  if (count > 0) {
    return 'exists';
  }
  const email = ownerEmail?.trim().toLowerCase();
  if (!email) {
    return 'missing';
  }
  const at = new Date();
  const id = newId('staff');
  await db.transaction(async tx => {
    await tx.insert(staff).values({
      id,
      email,
      role: 'OWNER',
      status: 'ACTIVE',
      createdAt: at,
      updatedAt: at,
    });
    await tx.insert(auditLog).values({
      id: newId('aud'),
      staffId: id,
      action: 'staff.owner_created',
      targetType: 'staff',
      targetId: id,
      after: { email, role: 'OWNER', source: 'OWNER_EMAIL' },
      createdAt: at,
    });
  });
  return 'created';
}
