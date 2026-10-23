import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { request } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { Vehicle } from '../../domain/jobs/request';
import { mockVehicles } from './mockVehicles';

export type VehicleInput = Omit<Vehicle, 'id'>;

/**
 * One copy of "My vehicles" for the whole app (account screen, booking),
 * loaded once per session from GET /me/vehicles and updated as the
 * customer adds or removes one. `null` until the server has answered.
 * Demo mode keeps the sample cars in memory.
 */
let loadedFor: string | null = null;
let vehicles: Vehicle[] | null = null;
let demoVehicles: Vehicle[] = mockVehicles;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const changed = () => listeners.forEach(l => l());

export function useVehicles() {
  const { state } = useAuth();
  const token = state.status === 'signedIn' ? state.token : null;
  // Like the rest of the data (backend.ts): sample data until signed in.
  const demo = !token;
  const current = useSyncExternalStore(subscribe, () => (demo ? demoVehicles : vehicles));

  useEffect(() => {
    if (!token || loadedFor === token) {
      return;
    }
    loadedFor = token;
    vehicles = null;
    changed();
    request<Vehicle[]>('/me/vehicles', { token })
      .then(list => {
        if (loadedFor === token) {
          vehicles = list;
          changed();
        }
      })
      // Shown as empty; the next sign-in tries again.
      .catch(() => {
        if (loadedFor === token) {
          vehicles = [];
          changed();
        }
      });
  }, [token]);

  /** Saves a new vehicle and returns it with its id. */
  const add = useCallback(
    async (input: VehicleInput) => {
      if (!token) {
        const vehicle = { ...input, id: `demo-${Date.now()}` };
        demoVehicles = [vehicle, ...demoVehicles];
        changed();
        return vehicle;
      }
      const vehicle = await request<Vehicle>('/me/vehicles', {
        method: 'POST',
        body: input,
        token,
      });
      vehicles = [vehicle, ...(vehicles ?? [])];
      changed();
      return vehicle;
    },
    [token],
  );

  const remove = useCallback(
    async (id: string) => {
      if (token) {
        await request(`/me/vehicles/${id}`, { method: 'DELETE', token });
        vehicles = (vehicles ?? []).filter(v => v.id !== id);
      } else {
        demoVehicles = demoVehicles.filter(v => v.id !== id);
      }
      changed();
    },
    [token],
  );

  return { vehicles: current, add, remove };
}
