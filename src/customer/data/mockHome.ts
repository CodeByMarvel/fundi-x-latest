/**
 * Placeholder data for the customer home screen until the backend exists.
 */

import { mockProviders } from '../../data/mock/mockProviders';

export type { Provider, ProviderType } from '../../domain/providers/types';

export type RecentService = {
  id: string;
  car: string;
  service: string;
  date: string;
  price: string;
};

export const customer = {
  firstName: 'Lenny',
  location: 'Nairobi, Kenya',
};

export const nearbyProviders = mockProviders;

export const recentService: RecentService | null = {
  id: 'rs-1',
  car: 'Toyota Fielder',
  service: 'Oil change',
  date: '12 Sep 2026',
  price: 'KES 3,500',
};
