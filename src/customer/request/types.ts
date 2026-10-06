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

export type MediaItem = {
  id: string;
  type: 'photo' | 'video';
  uri: string;
};

/** Question id -> selected option ids. */
export type Answers = Record<string, string[]>;

/** Everything the customer has told us so far while building a request. */
export type RequestDraft = {
  requestType?: RequestType;
  vehicleId?: string;
  categoryId?: string;
  answers: Answers;
  description: string;
  media: MediaItem[];
  drivability?: Drivability;
  location?: RequestLocation;
  urgency?: Urgency;
  scheduledFor?: ScheduledFor;
};

export const EMPTY_DRAFT: RequestDraft = {
  answers: {},
  description: '',
  media: [],
};

// ---- Decision tree definitions ----

export type QuestionOption = {
  id: string;
  label: string;
  description?: string;
  /** Questions to ask next if this option is picked. */
  followUps?: string[];
};

export type Question = {
  id: string;
  title: string;
  subtitle?: string;
  /** Allow picking more than one option. */
  multi?: boolean;
  options: QuestionOption[];
};

/** How strongly to encourage photos/video for a category. */
export type MediaHint = 'essential' | 'helpful' | 'optional';

export type JobCategory = {
  id: string;
  requestType: RequestType;
  label: string;
  description?: string;
  /** Questions asked first for this category, in order. */
  questions: string[];
  mediaHint: MediaHint;
};
