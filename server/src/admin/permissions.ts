import type { StaffRole } from '../db/schema';

/**
 * Everything a staff member can be allowed to do. Each admin endpoint
 * names the one permission it needs, so giving someone a narrower role
 * later is a data change, not a code change.
 */
export const PERMISSIONS = [
  'jobs.view',
  'jobs.cancel',
  'money.view',
  'money.refund',
  'users.view',
  'users.suspend',
  'providers.verify',
  'settings.edit',
  'logs.view',
  'incidents.resolve',
  'timers.retry',
  'staff.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do. Today Fundi-X is one person, so there is one
 * role with everything. Hiring adds roles here, for example:
 *   SUPPORT:  jobs.view, jobs.cancel, users.view, users.suspend
 *   ACCOUNTS: jobs.view, money.view, money.refund
 * The full planned list is in docs/admin-portal.md §5.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
};

export const can = (role: StaffRole, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);
