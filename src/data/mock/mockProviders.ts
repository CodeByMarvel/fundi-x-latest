import { Provider } from '../../domain/providers/types';

/** Placeholder providers until they come from the backend. */
export const mockProviders: Provider[] = [
  {
    id: 'p1',
    name: 'Brian Otieno',
    type: 'mechanic',
    specialty: 'Brakes & suspension',
    rating: 4.8,
    ratingCount: 126,
    distanceKm: 1.2,
    phone: '254712000101',
    online: true,
  },
  {
    id: 'p2',
    name: 'Kilimani Auto Garage',
    type: 'garage',
    specialty: 'Full service',
    rating: 4.6,
    ratingCount: 340,
    distanceKm: 2.5,
    phone: '254722000202',
    online: true,
  },
  {
    id: 'p3',
    name: 'Grace Wanjiku',
    type: 'mechanic',
    specialty: 'Engine diagnostics',
    rating: 4.9,
    ratingCount: 88,
    distanceKm: 3.1,
    phone: '254733000303',
    online: true,
  },
];
