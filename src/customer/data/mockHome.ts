/**
 * Placeholder data for the customer home screen until the backend exists.
 */

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
  lastName: 'Mwangi',
  location: 'Nairobi, Kenya',
  /** Used to prefill M-Pesa payments. */
  mpesaPhone: '0712 345 678',
  email: 'lenny@example.com',
};
