import type {
  Answers,
  Drivability,
  RequestLocation,
  RequestType,
  ScheduledFor,
  Urgency,
  Vehicle,
} from '../../customer/request/types';
import type { Cents } from '../money';

/**
 * Where a job is in its lifecycle. This is the domain's view of a job, not
 * what anyone reads: each app translates it into friendly text.
 *
 * There's no "paid" status on purpose: whether money moved is a fact about a
 * Payment, not a stage of the work (see docs/job-flow.md, principle 2).
 */
export type JobStatus =
  | 'CALL_OUT_PAYMENT_PENDING'
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
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED';

/** Who caused a change. SYSTEM is the platform itself (matching, payments). */
export type JobActor = 'CUSTOMER' | 'PROVIDER' | 'SYSTEM';

/**
 * FIXED: Fundi-X priced the work before booking (maintenance from the
 * catalog), so there's no diagnosis or provider quote.
 * QUOTED: the provider diagnoses on site and sends a quote (repairs, and any
 * service the catalog can't price).
 */
export type PricingMode = 'FIXED' | 'QUOTED';

/** Kept JSON-friendly so events can be stored and sent as-is. */
export type JobEventMetadata = Record<string, string | number | boolean | null>;

export type Job = {
  id: string;
  customerId: string;
  pricingMode: PricingMode;
  /** The provider assigned to the job. Cleared if they withdraw. */
  providerId?: string;
  /**
   * The provider currently being asked to take the job. Only set while the
   * job is OFFERED; past offers live in the job's events.
   */
  offeredProviderId?: string;
  /** When the current offer lapses. Only set while OFFERED. */
  offerExpiresAt?: string;
  /** Live estimate while the provider is EN_ROUTE. */
  etaMinutes?: number;
  /** When the provider reached the vehicle; starts the no-show wait. */
  arrivedAt?: string;
  /** Set when an assigned provider withdrew and the job went back to searching. */
  reassignment?: JobReassignment;

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

  /** The latest version of the main quote, whatever its status. */
  baseQuoteId?: string;
  /** What the provider says they did, given when marking the work complete. */
  workSummary?: string;
  cancellation?: JobCancellation;
  dispute?: JobDispute;
  rating?: JobRating;

  status: JobStatus;
  /** ISO 8601 timestamps, the way an API sends them. */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CancellationReason =
  | 'call_out_unpaid'
  | 'customer_cancelled'
  | 'no_provider_available'
  | 'quote_declined'
  | 'customer_no_show'
  | 'dispute_closed';

export type JobCancellation = {
  by: JobActor;
  reason: CancellationReason;
  /** The status the job was in, which decides refund vs release. */
  fromStatus: JobStatus;
  /** Free text, e.g. why it was cancelled. */
  note?: string;
};

export type JobReassignment = {
  /** The provider who withdrew. */
  providerId: string;
  note?: string;
  at: string;
};

export type JobDispute = {
  reason: string;
  /** Filled in by support once they've reviewed it. */
  resolution?: string;
};

export type JobRating = {
  /** 1 to 5 */
  stars: number;
  comment: string;
  createdAt: string;
};

/** What the customer described when booking. */
export type JobRequestDetails = Pick<
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

/**
 * The prices the customer saw and agreed to. The backend recalculates them
 * and refuses the booking if they no longer match, so nobody is charged a
 * price they didn't see.
 */
export type AcceptedPrice = {
  callOut: Cents;
  /** Only for FIXED pricing: the Fundi-X service price. */
  fixedServiceTotal?: Cents;
};

/**
 * What a customer supplies to open a job. Everything else (id, customerId,
 * status, pricing mode, timestamps) is decided by the backend.
 */
export type CreateJobInput = JobRequestDetails & {
  acceptedPrice: AcceptedPrice;
};

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
