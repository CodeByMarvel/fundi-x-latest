import { Job, JobActor, JobEvent, JobEventMetadata, JobStatus } from './types';

type TransitionTable = Record<
  JobStatus,
  Partial<Record<JobStatus, readonly JobActor[]>>
>;

/**
 * Every allowed status change, and who may make it. Anything not listed here
 * is forbidden. Typing it as Record<JobStatus, …> means adding a new status
 * won't compile until its row is added.
 */
export const TRANSITIONS: TransitionTable = {
  SEARCHING: {
    OFFERED: ['SYSTEM'],
    // SYSTEM: nobody could be found.
    CANCELLED: ['CUSTOMER', 'SYSTEM'],
  },
  OFFERED: {
    ACCEPTED: ['PROVIDER'],
    // The offer was declined (PROVIDER) or expired (SYSTEM): try someone else.
    SEARCHING: ['PROVIDER', 'SYSTEM'],
    CANCELLED: ['CUSTOMER'],
  },
  ACCEPTED: {
    EN_ROUTE: ['PROVIDER'],
    CANCELLED: ['CUSTOMER', 'PROVIDER'],
  },
  EN_ROUTE: {
    ARRIVED: ['PROVIDER'],
    CANCELLED: ['CUSTOMER', 'PROVIDER'],
  },
  ARRIVED: {
    DIAGNOSING: ['PROVIDER'],
  },
  DIAGNOSING: {
    QUOTE_SENT: ['PROVIDER'],
  },
  QUOTE_SENT: {
    // Customer approves the quote.
    IN_PROGRESS: ['CUSTOMER'],
    // Customer rejects the quote and pays only the call-out/inspection fee.
    PAYMENT_PENDING: ['CUSTOMER'],
    // Provider withdraws the quote to revise it. While the job is back in
    // DIAGNOSING, the old quote can't be approved.
    DIAGNOSING: ['PROVIDER'],
  },
  IN_PROGRESS: {
    AWAITING_CONFIRMATION: ['PROVIDER'],
  },
  AWAITING_CONFIRMATION: {
    PAYMENT_PENDING: ['CUSTOMER'],
    DISPUTED: ['CUSTOMER'],
  },
  PAYMENT_PENDING: {
    // Only the payment system can say money arrived. A failed payment leaves
    // the job here so the customer can retry.
    PAID: ['SYSTEM'],
  },
  PAID: {
    COMPLETED: ['SYSTEM'],
  },
  COMPLETED: {},
  CANCELLED: {},
  // Resolved by support later; nothing in the app moves it on yet.
  DISPUTED: {},
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

export function canTransition(
  from: JobStatus,
  to: JobStatus,
  actor: JobActor,
): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** The statuses `actor` may move a job to from `status`, e.g. to pick buttons. */
export function allowedNextStatuses(
  status: JobStatus,
  actor: JobActor,
): JobStatus[] {
  return (Object.keys(TRANSITIONS[status]) as JobStatus[]).filter(to =>
    canTransition(status, to, actor),
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
  if (!canTransition(job.status, to, actor)) {
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
