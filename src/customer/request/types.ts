// The request vocabulary lives in the domain, shared with the backend.
import type {
  Answers,
  Drivability,
  RequestLocation,
  RequestType,
  ScheduledFor,
  Urgency,
} from '../../domain/jobs/request';
export type {
  Answers,
  Drivability,
  LocationKind,
  RequestLocation,
  RequestType,
  ScheduledFor,
  Urgency,
  Vehicle,
} from '../../domain/jobs/request';

export type MediaItem = {
  id: string;
  type: 'photo' | 'video';
  uri: string;
};

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
