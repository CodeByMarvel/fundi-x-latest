import { useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { providerRepository } from '../../data/backend';
import { useProvider, useProviderCurrentJob } from '../../data/useJob';
import { currentPosition } from '../../shared/location/currentPosition';
import { useCurrentProviderId } from '../data/currentMechanic';

/** How often the phone tells the server where the mechanic is. */
export const LOCATION_REPORT_MS = 30_000;

/**
 * Sends the mechanic's position every 30 s while they're online (so
 * matching finds them; the server ignores positions older than 5 minutes)
 * or driving to a job (so the customer's ETA stays live). Stops otherwise:
 * we don't track mechanics who aren't working.
 *
 * Only while the app is open for now. Reporting with the app in the
 * background (e.g. while they navigate in Google Maps) needs an Android
 * foreground service, a later step.
 */
export function useLocationReporting() {
  const { state } = useAuth();
  const me = useCurrentProviderId();
  const online = useProvider(me)?.online ?? false;
  const status = useProviderCurrentJob(me)?.status;
  const onTheWay = status === 'ACCEPTED' || status === 'EN_ROUTE';
  // Demo mode has no map: don't ask for GPS there.
  const share = state.status === 'signedIn' && (online || onTheWay);

  useEffect(() => {
    if (!share) {
      return;
    }
    const report = () =>
      currentPosition()
        .then(providerRepository.reportLocation)
        .catch(() => {
          // No fix right now (tunnel, GPS off): try again next time.
        });
    report();
    const timer = setInterval(report, LOCATION_REPORT_MS);
    return () => clearInterval(timer);
  }, [share]);
}
