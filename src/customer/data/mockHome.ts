/**
 * Placeholder data for the customer home screen until the backend exists.
 */

export type ProviderType = 'mechanic' | 'garage';

export type ActiveJob = {
  id: string;
  car: string;
  service: string;
  mechanicName: string;
  status: string;
  /** 0 to 1 */
  progress: number;
};

export type Provider = {
  id: string;
  name: string;
  type: ProviderType;
  specialty: string;
  rating: number;
  distanceKm: number;
};

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

export const activeJob: ActiveJob | null = {
  id: 'job-1',
  car: 'Toyota Fielder',
  service: 'Brake inspection',
  mechanicName: 'Brian',
  status: 'is on the way',
  progress: 0.35,
};

export const nearbyProviders: Provider[] = [
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

export const recentService: RecentService | null = {
  id: 'rs-1',
  car: 'Toyota Fielder',
  service: 'Oil change',
  date: '12 Sep 2026',
  price: 'KES 3,500',
};
