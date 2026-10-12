import { Provider, ReliabilityEvent } from './types';

export interface ProviderRepository {
  /** A provider goes online (gets offered jobs) or offline (doesn't). */
  setOnline(providerId: string, online: boolean): Promise<Provider>;

  getProviderSnapshot(providerId: string): Provider | undefined;
  getProvidersSnapshot(): readonly Provider[];
  /** Every reliability event, oldest first. Same array until something changes. */
  getReliabilityEventsSnapshot(): readonly ReliabilityEvent[];
  subscribe(listener: () => void): () => void;
}
