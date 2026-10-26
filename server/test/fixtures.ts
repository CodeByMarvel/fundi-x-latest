import { sql } from 'drizzle-orm';
import type { JobRequestDetails } from '../../src/domain/jobs/types';
import type { Catalog } from '../../src/domain/pricing/catalog';
import { calculateEstimate } from '../../src/domain/pricing/engine';
import type { Database } from '../src/db/client';
import { providers, users } from '../src/db/schema';

export const REPAIR: JobRequestDetails = {
  requestType: 'repair',
  categoryId: 'brakes',
  vehicle: {
    id: 'v1',
    make: 'Toyota',
    model: 'Fielder',
    registration: 'KDA 123A',
    year: 2015,
  },
  answers: { 'brakes.symptoms': ['noise'] },
  description: 'Grinding when I stop',
  drivability: 'caution',
  location: {
    kind: 'home',
    label: 'Home',
    address: 'Kileleshwa',
    coords: { lat: -1.2795, lng: 36.7845 },
  },
  urgency: 'now',
};
export const SERVICE: JobRequestDetails = {
  ...REPAIR,
  requestType: 'service',
  categoryId: 'oil_service',
  answers: {},
  description: '',
};

export const WANJIRU = { 'x-dev-user': 'customer:wanjiru' };
export const OTIENO = { 'x-dev-user': 'customer:otieno' };
export const BRIAN = { 'x-dev-user': 'provider:p1' };

/** The booking body the app sends: details + the price the customer saw. */
export function booking(details: JobRequestDetails, callOutFee?: number, catalog?: Catalog) {
  const estimate = calculateEstimate(details, callOutFee, catalog);
  return {
    ...details,
    acceptedPrice: {
      callOut: estimate.callOut,
      ...(estimate.fixedService && {
        fixedServiceTotal: estimate.fixedService.total,
      }),
    },
  };
}

/**
 * Empties every table, so each test starts from nothing but the accounts
 * the fixtures above sign in as.
 */
export async function resetTables(db: Database) {
  await db.execute(
    sql`TRUNCATE files, app_sessions, incidents, audit_log, staff_sessions, staff, users, providers, settings, jobs, job_matching, job_events, charges, payments, refunds, releases, quotes, reliability_events, timers, catalog_versions, support_notes, ledger_entries, ledger_lines, transfers, saved_places, vehicles`,
  );
  const at = new Date();
  const account = { status: 'ACTIVE' as const, createdAt: at, updatedAt: at };
  await db.insert(users).values([
    { id: 'wanjiru', phone: '254700000001', name: 'Wanjiru', role: 'CUSTOMER', ...account },
    { id: 'otieno', phone: '254700000002', name: 'Otieno', role: 'CUSTOMER', ...account },
    { id: 'p1', phone: '254712000101', name: 'Brian', role: 'PROVIDER', ...account },
  ]);
  await db.insert(providers).values({
    userId: 'p1',
    type: 'mechanic',
    specialty: 'Brakes',
    payoutPhone: '254712000101',
    verification: 'VERIFIED',
    createdAt: at,
    updatedAt: at,
  });
}
