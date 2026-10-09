import {
  Job,
  JobActor,
  JobEvent,
  JobEventMetadata,
  JobStatus,
  PricingMode,
} from './types';

/**
 * Who may make a move, and (optionally) for which kind of job. `onlyFor` is
 * a guard: a condition on the job itself, beyond its status.
 */
type TransitionRule = {
  actors: readonly JobActor[];
  onlyFor?: PricingMode;
};

type TransitionTable = Record<
  JobStatus,
  Partial<Record<JobStatus, TransitionRule>>
>;

const by = (...actors: JobActor[]): TransitionRule => ({ actors });

/**
 * Every allowed status change, and who may make it (docs/job-flow.md §6).
 * Anything not listed is forbidden. Typing it as Record<JobStatus, …> means
 * adding a new status won't compile until its row is added.
 *
 * Money consequences (refund vs release) aren't here: they're decided when
 * the job ends, from how and where it ended (see domain/billing).
 */
export const TRANSITIONS: TransitionTable = {
  CALL_OUT_PAYMENT_PENDING: {
    // Only the payment system can confirm the call-out arrived.
    SEARCHING: by('SYSTEM'),
    // Customer abandons, or SYSTEM gives up after 30 min unpaid.
    CANCELLED: by('CUSTOMER', 'SYSTEM'),
  },
  SEARCHING: {
    OFFERED: by('SYSTEM'),
    // SYSTEM: nobody could be found.
    CANCELLED: by('CUSTOMER', 'SYSTEM'),
  },
  OFFERED: {
    ACCEPTED: by('PROVIDER'),
    // The offer was declined (PROVIDER) or expired (SYSTEM): try someone else.
    SEARCHING: by('PROVIDER', 'SYSTEM'),
    CANCELLED: by('CUSTOMER'),
  },
  ACCEPTED: {
    EN_ROUTE: by('PROVIDER'),
    // Provider withdraws: find someone else, the call-out stays in escrow.
    SEARCHING: by('PROVIDER'),
    CANCELLED: by('CUSTOMER'),
  },
  EN_ROUTE: {
    ARRIVED: by('PROVIDER'),
    SEARCHING: by('PROVIDER'),
    // Allowed, but the call-out is no longer refunded.
    CANCELLED: by('CUSTOMER'),
  },
  ARRIVED: {
    DIAGNOSING: { actors: ['PROVIDER'], onlyFor: 'QUOTED' },
    // Fixed-price work was agreed at booking: start straight away.
    IN_PROGRESS: { actors: ['PROVIDER'], onlyFor: 'FIXED' },
    // Customer not at the location after the 15-minute wait.
    CANCELLED: by('PROVIDER'),
  },
  DIAGNOSING: {
    QUOTE_SENT: by('PROVIDER'),
  },
  QUOTE_SENT: {
    // Customer approves the quote.
    IN_PROGRESS: by('CUSTOMER'),
    // Provider withdraws the quote to revise it. While the job is back in
    // DIAGNOSING, the old quote can't be approved.
    DIAGNOSING: by('PROVIDER'),
    // Customer declines the repair. The call-out paid for the visit.
    CANCELLED: by('CUSTOMER'),
  },
  IN_PROGRESS: {
    AWAITING_CONFIRMATION: by('PROVIDER'),
  },
  AWAITING_CONFIRMATION: {
    // Customer confirms, or SYSTEM auto-confirms after 48 h of silence.
    PAYMENT_PENDING: by('CUSTOMER', 'SYSTEM'),
    DISPUTED: by('CUSTOMER'),
  },
  PAYMENT_PENDING: {
    // Only the payment system can say the money arrived.
    COMPLETED: by('SYSTEM'),
  },
  COMPLETED: {},
  CANCELLED: {},
  // Fundi-X support reviews the dispute.
  DISPUTED: {
    // The provider goes back to fix it at no extra cost.
    IN_PROGRESS: by('SYSTEM'),
    // The work was fine: the customer pays.
    PAYMENT_PENDING: by('SYSTEM'),
    // Closed without charge.
    CANCELLED: by('SYSTEM'),
  },
};

export class JobTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
    readonly actor: JobActor,
  ) {
    super(`${actor} cannot move a job from ${from} to ${to}`);
    this.name = 'JobTransitionError';
    // Keeps `instanceof JobTransitionError` working when classes are transpiled.
    Object.setPrototypeOf(this, JobTransitionError.prototype);
  }
}

/** The parts of a job the rules look at. */
type JobState = Pick<Job, 'status' | 'pricingMode'>;

export function canTransition(
  job: JobState,
  to: JobStatus,
  actor: JobActor,
): boolean {
  const rule = TRANSITIONS[job.status][to];
  if (!rule || !rule.actors.includes(actor)) {
    return false;
  }
  return !rule.onlyFor || rule.onlyFor === job.pricingMode;
}

/** The statuses `actor` may move this job to, e.g. to pick buttons. */
export function allowedNextStatuses(
  job: JobState,
  actor: JobActor,
): JobStatus[] {
  return (Object.keys(TRANSITIONS[job.status]) as JobStatus[]).filter(to =>
    canTransition(job, to, actor),
  );
}

export function isTerminalStatus(status: JobStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

type TransitionContext = {
  /** ISO timestamp for the change. Passed in so this function stays pure. */
  now: string;
  eventId: string;
  metadata?: JobEventMetadata;
};

/**
 * Moves a job to a new status and records why. Returns a new job rather than
 * changing the one passed in. Throws JobTransitionError if the move isn't
 * allowed.
 */
export function applyTransition(
  job: Job,
  to: JobStatus,
  actor: JobActor,
  { now, eventId, metadata }: TransitionContext,
): { job: Job; event: JobEvent } {
  if (!canTransition(job, to, actor)) {
    throw new JobTransitionError(job.status, to, actor);
  }

  const event: JobEvent = {
    id: eventId,
    jobId: job.id,
    fromStatus: job.status,
    toStatus: to,
    actor,
    createdAt: now,
    ...(metadata && { metadata }),
  };

  return { job: { ...job, status: to, updatedAt: now }, event };
}
