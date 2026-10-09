import { Provider } from './types';

export interface ProviderRepository {
  /** A provider goes online (gets offered jobs) or offline (doesn't). */
  setOnline(providerId: string, online: boolean): Promise<Provider>;

  getProviderSnapshot(providerId: string): Provider | undefined;
  getProvidersSnapshot(): readonly Provider[];
  subscribe(listener: () => void): () => void;
}
