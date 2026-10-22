import { useEffect, useState } from 'react';
import { request } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { useProviders } from '../../data/useJob';
import { Provider } from '../../domain/providers/types';
import { currentPosition } from '../../shared/location/currentPosition';

const REFRESH_MS = 60_000;

/**
 * Mechanics free to take a job near the customer, for the home screen.
 * Signed in: asked of the server (GET /providers/nearby) from where the
 * phone is, every minute while the home screen is mounted (the tab stays
 * mounted, mechanics come and go). No location permission
 * or no connection just means an empty list: the home screen doesn't nag.
 * Demo mode: the simulation's providers.
 */
export function useNearbyProviders(): readonly Provider[] {
  const { state } = useAuth();
  const token = state.status === 'signedIn' ? state.token : null;
  const simulated = useProviders();
  const [found, setFound] = useState<Provider[]>([]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    const look = () =>
      currentPosition('see mechanics near you')
        .then(({ lat, lng }) =>
          request<Provider[]>(`/providers/nearby?lat=${lat}&lng=${lng}`, { token }),
        )
        .then(list => !cancelled && setFound(list))
        .catch(() => {});
    look();
    const timer = setInterval(look, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  return token ? found : simulated;
}
