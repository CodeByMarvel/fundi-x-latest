import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { request } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { Coordinates } from '../../domain/jobs/request';

export type PlaceKind = 'home' | 'work';

/** A customer's saved place, kept on the server (GET /me/places). */
export type SavedPlace = {
  kind: PlaceKind;
  address: string;
  coords: Coordinates;
};

/** Demo mode's sample places, so the simulation books without GPS. */
const DEMO_PLACES: SavedPlace[] = [
  { kind: 'home', address: 'Kileleshwa, Nairobi', coords: { lat: -1.2795, lng: 36.7845 } },
  { kind: 'work', address: 'Westlands, Nairobi', coords: { lat: -1.2655, lng: 36.8025 } },
];

/**
 * One copy of the places for the whole app (home header, account screen,
 * booking), loaded once per session and replaced when one is saved.
 * `null` until the server has answered.
 */
let loadedFor: string | null = null;
let places: SavedPlace[] | null = null;
let demoPlaces = DEMO_PLACES;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const set = (next: SavedPlace[] | null) => {
  places = next;
  listeners.forEach(l => l());
};

export function useSavedPlaces() {
  const { state } = useAuth();
  const token = state.status === 'signedIn' ? state.token : null;
  const demo = state.status === 'demo';
  const current = useSyncExternalStore(subscribe, () => (demo ? demoPlaces : places));

  useEffect(() => {
    if (!token || loadedFor === token) {
      return;
    }
    loadedFor = token;
    set(null);
    request<SavedPlace[]>('/me/places', { token })
      .then(list => loadedFor === token && set(list))
      // Shown as "not saved yet"; the next sign-in tries again.
      .catch(() => loadedFor === token && set([]));
  }, [token]);

  const save = useCallback(
    async (kind: PlaceKind, address: string, coords: Coordinates) => {
      const place: SavedPlace = token
        ? await request<SavedPlace>(`/me/places/${kind}`, {
            method: 'PUT',
            body: { address, coords },
            token,
          })
        : { kind, address, coords };
      const others = (list: SavedPlace[] | null) => (list ?? []).filter(p => p.kind !== kind);
      if (token) {
        set([...others(places), place]);
      } else {
        demoPlaces = [...others(demoPlaces), place];
        listeners.forEach(l => l());
      }
      return place;
    },
    [token],
  );

  const find = (kind: PlaceKind) => current?.find(p => p.kind === kind);
  return { places: current, home: find('home'), work: find('work'), save };
}
