import { Coordinates } from '../jobs/request';
import { Provider, ReliabilityEvent } from './types';

export interface ProviderRepository {
  /**
   * A provider goes online (gets offered jobs) or offline (doesn't). Going
   * online needs `location`, so they can be matched straight away.
   */
  setOnline(
    providerId: string,
    online: boolean,
    location?: Coordinates,
  ): Promise<Provider>;
  /**
   * Where the provider is now, sent every ~30 s while online or on the way
   * to a job (matching and the customer's live ETA use it).
   */
  reportLocation(location: Coordinates): Promise<void>;

  getProviderSnapshot(providerId: string): Provider | undefined;
  getProvidersSnapshot(): readonly Provider[];
  /** Every reliability event, oldest first. Same array until something changes. */
  getReliabilityEventsSnapshot(): readonly ReliabilityEvent[];
  subscribe(listener: () => void): () => void;
}
