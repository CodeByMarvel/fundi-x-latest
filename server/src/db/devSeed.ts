import { and, inArray, isNull } from 'drizzle-orm';
import { SKILL_IDS } from '../../../src/domain/providers/skills';
import type { Database } from './client';
import { providers, users } from './schema';

/**
 * DEVELOPMENT ONLY: the accounts the app's mock already uses (customer-1,
 * providers p1–p3), so the app can talk to a local server before real
 * sign-up exists. Safe to run on every start: existing rows are left alone.
 */
export async function seedDevData(db: Database) {
  const at = new Date();
  const stamp = { status: 'ACTIVE' as const, createdAt: at, updatedAt: at };

  await db
    .insert(users)
    .values([
      { id: 'customer-1', phone: '254700000001', name: 'Wanjiru Kamau', role: 'CUSTOMER', ...stamp },
      { id: 'p1', phone: '254712000101', name: 'Brian Otieno', role: 'PROVIDER', ...stamp },
      { id: 'p2', phone: '254722000202', name: 'James Mwangi', role: 'PROVIDER', ...stamp },
      { id: 'p3', phone: '254733000303', name: 'Grace Wanjiku', role: 'PROVIDER', ...stamp },
    ])
    .onConflictDoNothing();

  const provider = { verification: 'VERIFIED' as const, online: true, createdAt: at, updatedAt: at };
  await db
    .insert(providers)
    .values([
      { userId: 'p1', type: 'mechanic', specialty: 'Brakes & suspension', payoutPhone: '254712000101', ...provider },
      { userId: 'p2', type: 'garage', businessName: 'Kilimani Auto Garage', specialty: 'Full service', payoutPhone: '254722000202', ...provider },
      { userId: 'p3', type: 'mechanic', specialty: 'Engine diagnostics', payoutPhone: '254733000303', ...provider },
    ])
    .onConflictDoNothing();

  // Profile v2 (skills, base, travel limit): the demo mechanics take every
  // kind of job anywhere in Nairobi. Filled in once, also on databases
  // seeded before v2 existed; later edits are kept.
  await db
    .update(providers)
    .set({
      skills: [...SKILL_IDS],
      experienceYears: 6,
      transport: 'motorbike',
      baseLat: -1.2921,
      baseLng: 36.7856,
      baseDescription: 'Kilimani, Nairobi',
      travelKm: 25,
    })
    .where(and(inArray(providers.userId, ['p1', 'p2', 'p3']), isNull(providers.skills)));
}
