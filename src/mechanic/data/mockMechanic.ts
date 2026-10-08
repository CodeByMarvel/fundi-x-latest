/**
 * Placeholder data for the mechanic side until login and the backend exist.
 */

import { mockProviders } from '../../data/mock/mockProviders';
import { kes } from '../../domain/money';

/** Until login exists, the mechanic side is always this provider. */
export const CURRENT_PROVIDER_ID = 'p1';

export const currentProvider = mockProviders.find(
  p => p.id === CURRENT_PROVIDER_ID,
)!;

export const mechanicProfile = {
  firstName: 'Brian',
  location: 'Kilimani, Nairobi',
};

// TODO: derive from completed jobs and payments once those exist.
export const todayStats = {
  earnings: kes(4500),
  jobsCompleted: 2,
};
