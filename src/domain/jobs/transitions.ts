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
    // On time: call-out kept. Late (arrival + grace passed): refunded.
    CANCELLED: by('CUSTOMER'),
  },
  ARRIVED: {
    DIAGNOSING: { actors: ['PROVIDER'], onlyFor: 'QUOTED' },
    // Fixed price already agreed: the provider checks the vehicle matches,
    // then the customer pays into escrow before work starts.
    SERVICE_PAYMENT_PENDING: { actors: ['PROVIDER'], onlyFor: 'FIXED' },
    // CUSTOMER changes their mind (call-out kept), or PROVIDER reports a
    // no-show after the 15-minute wait.
    CANCELLED: by('CUSTOMER', 'PROVIDER'),
  },
  DIAGNOSING: {
    QUOTE_SENT: by('PROVIDER'),
    CANCELLED: by('CUSTOMER'),
  },
  QUOTE_SENT: {
    // Customer approves; next they pay it into escrow.
    SERVICE_PAYMENT_PENDING: by('CUSTOMER'),
    // Provider withdraws the quote to revise it. While the job is back in
    // DIAGNOSING, the old quote can't be approved.
    DIAGNOSING: by('PROVIDER'),
    // Customer declines the repair. The call-out paid for the visit.
    CANCELLED: by('CUSTOMER'),
  },
  SERVICE_PAYMENT_PENDING: {
    // Only the payment system can say the money reached escrow.
    IN_PROGRESS: by('SYSTEM'),
    // Work hasn't started, so the customer can still leave (call-out kept);
    // SYSTEM closes it if unpaid after 30 min.
    CANCELLED: by('CUSTOMER', 'SYSTEM'),
  },
  IN_PROGRESS: {
    AWAITING_CONFIRMATION: by('PROVIDER'),
  },
  AWAITING_CONFIRMATION: {
    // Customer confirms, or SYSTEM auto-confirms after 48 h of silence. The
    // money is already in escrow, so confirming completes the job.
    COMPLETED: by('CUSTOMER', 'SYSTEM'),
    DISPUTED: by('CUSTOMER'),
  },
  COMPLETED: {},
  CANCELLED: {},
  // Fundi-X support resolves the dispute.
  DISPUTED: {
    // REWORK: the provider fixes it at no extra cost.
    IN_PROGRESS: by('SYSTEM'),
    // UPHOLD_PROVIDER: the work was fine.
    COMPLETED: by('SYSTEM'),
    // SPLIT: escrow divided as support decided.
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

/**
 * Drops fields that only make sense in some statuses, so a job never says
 * it's "offered to Brian" after being cancelled, or shows an ETA after the
 * provider has arrived. Callers add new values for the new status after.
 */
function clearStaleFields(job: Job): Job {
  const next = { ...job };
  if (next.status !== 'OFFERED') {
    delete next.offeredProviderId;
    delete next.offerExpiresAt;
  }
  if (next.status !== 'EN_ROUTE') {
    delete next.etaMinutes;
  }
  if (next.status === 'SEARCHING') {
    // Back to matching: nobody is assigned any more.
    delete next.providerId;
  }
  return next;
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

  return {
    job: clearStaleFields({ ...job, status: to, updatedAt: now }),
    event,
  };
}
