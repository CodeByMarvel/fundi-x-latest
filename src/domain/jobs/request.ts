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
