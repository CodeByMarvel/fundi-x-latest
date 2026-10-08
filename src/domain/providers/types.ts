export type ProviderType = 'mechanic' | 'garage';

/** A fundi or garage that can take jobs. */
export type Provider = {
  id: string;
  name: string;
  type: ProviderType;
  specialty: string;
  rating: number;
  distanceKm: number;
};
