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
};

export type Drivability = 'safe' | 'caution' | 'cannot' | 'unsure';

export type Urgency = 'now' | 'today' | 'scheduled';

export type LocationKind = 'current' | 'home' | 'work' | 'other';

export type RequestLocation = {
  kind: LocationKind;
  label: string;
  address: string;
};

export type ScheduledFor = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
};

/** Question id -> selected option ids. */
export type Answers = Record<string, string[]>;
