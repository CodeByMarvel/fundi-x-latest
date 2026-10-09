export type ProviderType = 'mechanic' | 'garage';

/** A fundi or garage that can take jobs. */
export type Provider = {
  id: string;
  name: string;
  type: ProviderType;
  specialty: string;
  rating: number;
  ratingCount: number;
  distanceKm: number;
  phone: string;
  /** Only online providers are offered jobs. */
  online: boolean;
};

/** Things that count against a provider's reliability (docs/job-flow.md §13). */
export type ReliabilityEventType =
  | 'offer_declined'
  | 'offer_expired'
  | 'withdrew_after_accepting'
  | 'withdrew_en_route'
  | 'late'
  | 'dispute_rework'
  | 'dispute_split';

/** A fact, not a penalty: thresholds and consequences are applied elsewhere. */
export type ReliabilityEvent = {
  id: string;
  providerId: string;
  jobId: string;
  type: ReliabilityEventType;
  at: string;
};
