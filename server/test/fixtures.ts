import { sql } from 'drizzle-orm';
import type { JobRequestDetails } from '../../src/domain/jobs/types';
import { calculateEstimate } from '../../src/domain/pricing/engine';
import type { Database } from '../src/db/client';

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
  location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
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
export function booking(details: JobRequestDetails) {
  const estimate = calculateEstimate(details);
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

/** Empties every table, so each test starts from nothing. */
export async function resetTables(db: Database) {
  await db.execute(
    sql`TRUNCATE jobs, job_events, charges, payments, refunds, releases, quotes, reliability_events, timers`,
  );
}
