/**
 * What a customer tells us about the job: the vocabulary shared by the
 * booking form, the backend and both apps. Lives in the domain so the
 * server can use it without depending on any app screen.
 */

export type RequestType = 'repair' | 'service';

export type Vehicle = {
  id: string;
  registration: string;
  make: string;
  model: string;
  year?: number;
  /** Engine size, if the customer knows it; decides the price class. */
  engineCc?: number;
  fuel?: Fuel;
};

export type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';

export type Drivability = 'safe' | 'caution' | 'cannot' | 'unsure';

export type Urgency = 'now' | 'today' | 'scheduled';

export type LocationKind = 'current' | 'home' | 'work' | 'other';

/** A point on the map, in degrees (WGS 84, what phones' GPS gives). */
export type Coordinates = { lat: number; lng: number };

export type RequestLocation = {
  kind: LocationKind;
  label: string;
  address: string;
  /**
   * Where the vehicle is. The backend turns it into an H3 cell to find
   * nearby providers (docs/job-flow.md §4), and requires it for booking.
   */
  coords?: Coordinates;
};

export type ScheduledFor = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
};

/** Question id -> selected option ids. */
export type Answers = Record<string, string[]>;

/** "2015 Toyota Fielder", for lists and job cards. */
export function vehicleName(v: Vehicle) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ');
}

/** "kda  123a" → "KDA 123A" (shown) and "KDA123A" (one car, however typed). */
export function normaliseRegistration(input: string) {
  const shown = input.trim().toUpperCase().replace(/\s+/g, ' ');
  return {
    registration: shown,
    registrationKey: shown.replace(/[^A-Z0-9]/g, ''),
  };
}

/** A vehicle's details without its id, e.g. to save it as a new one. */
export function vehicleDetails(v: Vehicle): Omit<Vehicle, 'id'> {
  const { registration, make, model, year, engineCc, fuel } = v;
  return {
    registration,
    make,
    model,
    ...(year !== undefined && { year }),
    ...(engineCc !== undefined && { engineCc }),
    ...(fuel && { fuel }),
  };
}

/** Whether two vehicles are the same car, however the plates were typed. */
export const sameCar = (
  a: Pick<Vehicle, 'registration'>,
  b: Pick<Vehicle, 'registration'>,
) =>
  normaliseRegistration(a.registration).registrationKey ===
  normaliseRegistration(b.registration).registrationKey;
