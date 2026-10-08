import type {
  Answers,
  Drivability,
  RequestLocation,
  RequestType,
  ScheduledFor,
  Urgency,
  Vehicle,
} from '../../customer/request/types';

/**
 * Where a job is in its lifecycle. This is the domain's view of a job, not
 * what the customer reads: screens translate it into friendly text.
 */
export type JobStatus =
  | 'SEARCHING'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'DIAGNOSING'
  | 'QUOTE_SENT'
  | 'IN_PROGRESS'
  | 'AWAITING_CONFIRMATION'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED';

/** Who caused a change. SYSTEM is the platform itself (matching, payments). */
export type JobActor = 'CUSTOMER' | 'PROVIDER' | 'SYSTEM';

/** Kept JSON-friendly so events can be stored and sent as-is. */
export type JobEventMetadata = Record<string, string | number | boolean | null>;

export type Job = {
  id: string;
  customerId: string;
  /** Set once a provider accepts. */
  providerId?: string;
  /**
   * The provider currently being asked to take the job. Only set while the
   * job is OFFERED; past offers live in the job's events.
   */
  offeredProviderId?: string;

  requestType: RequestType;
  categoryId: string;
  /**
   * A copy of the vehicle as it was when the job was created, so the job can
   * still be shown if the vehicle is later edited or removed.
   */
  vehicle: Vehicle;
  answers: Answers;
  description: string;
  drivability: Drivability;
  location: RequestLocation;
  urgency: Urgency;
  scheduledFor?: ScheduledFor;

  status: JobStatus;
  /** ISO 8601 timestamps, the way an API sends them. */
  createdAt: string;
  updatedAt: string;
};

/**
 * What a customer supplies to open a job. Everything else (id, customerId,
 * status, timestamps) is decided by the backend, not the app.
 */
export type CreateJobInput = Pick<
  Job,
  | 'requestType'
  | 'categoryId'
  | 'vehicle'
  | 'answers'
  | 'description'
  | 'drivability'
  | 'location'
  | 'urgency'
  | 'scheduledFor'
>;

/** One entry in a job's audit trail. Events are only ever added, never edited. */
export type JobEvent = {
  id: string;
  jobId: string;
  /** null for the event that records the job being created. */
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  actor: JobActor;
  createdAt: string;
  metadata?: JobEventMetadata;
};
