import { Provider } from '../../domain/providers/types';

/** Placeholder providers until they come from the backend. */
export const mockProviders: Provider[] = [
  {
    id: 'p1',
    name: 'Brian Otieno',
    type: 'mechanic',
    specialty: 'Brakes & suspension',
    rating: 4.8,
    distanceKm: 1.2,
  },
  {
    id: 'p2',
    name: 'Kilimani Auto Garage',
    type: 'garage',
    specialty: 'Full service',
    rating: 4.6,
    distanceKm: 2.5,
  },
  {
    id: 'p3',
    name: 'Grace Wanjiku',
    type: 'mechanic',
    specialty: 'Engine diagnostics',
    rating: 4.9,
    distanceKm: 3.1,
  },
];
