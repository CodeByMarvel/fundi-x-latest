import type { StaffRole } from '../db/schema';

/**
 * Everything a staff member can be allowed to do. Each admin endpoint
 * names the one permission it needs, so giving someone a narrower role
 * later is a data change, not a code change.
 */
export const PERMISSIONS = [
  'jobs.view',
  'jobs.cancel',
  'disputes.resolve',
  'money.view',
  'money.refund',
  'users.view',
  'users.suspend',
  'providers.verify',
  'settings.edit',
  'catalog.edit',
  'logs.view',
  'incidents.resolve',
  'timers.retry',
  'staff.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do (docs/admin-portal.md §5). A role that acts on
 * something also gets the view permission of the page it acts from, e.g.
 * verifying mechanics needs users.view to open the Mechanics list.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  OPERATIONS: ['jobs.view', 'jobs.cancel', 'users.view', 'users.suspend', 'providers.verify'],
  SUPPORT: ['jobs.view', 'jobs.cancel', 'users.view'],
  FINANCE: ['jobs.view', 'money.view', 'money.refund'],
  DEVELOPER: ['jobs.view', 'logs.view', 'incidents.resolve', 'timers.retry'],
  COMPLIANCE: ['jobs.view', 'users.view', 'providers.verify', 'disputes.resolve', 'logs.view'],
  MANAGER: ['jobs.view', 'users.view', 'money.view', 'logs.view'],
};

/** How the staff screen describes each role. */
export const ROLE_INFO: Record<StaffRole, { label: string; description: string }> = {
  OWNER: { label: 'Owner', description: 'Everything, including staff and settings' },
  OPERATIONS: { label: 'Operations', description: 'Jobs, mechanic verification, suspending accounts' },
  SUPPORT: { label: 'Support', description: 'Jobs and customers; cancel, refund or reassign a job' },
  FINANCE: { label: 'Finance', description: 'Money pages, refunds and M-Pesa transfers' },
  DEVELOPER: { label: 'Developer', description: 'System health, incidents, timers, audit log' },
  COMPLIANCE: { label: 'Compliance', description: 'Mechanic verification, disputes, audit log' },
  MANAGER: { label: 'Manager', description: 'Read-only across jobs, people, money and logs' },
};

export const can = (role: StaffRole, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);
