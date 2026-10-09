import { Job, JobStatus } from '../../domain/jobs/types';
import { PaymentFailureReason } from '../../domain/payments/types';
import type { PillTone } from '../../shared/components/StatusPill';

/**
 * How a status should feel: still moving, finished well, needs attention,
 * or stopped.
 */
export type StatusTone = PillTone;

export type CustomerStatusView = {
  title: string;
  subtitle: string;
  tone: StatusTone;
  /** Short form for small spaces like the home card. */
  short: string;
};

/**
 * What the customer reads for each job status. Typed as a Record over every
 * status, so a new status won't compile until it has wording here.
 */
const CUSTOMER_STATUS: Record<JobStatus, CustomerStatusView> = {
  SEARCHING: {
    title: 'Finding a trusted fundi near you',
    subtitle: "We're matching your request with available fundis nearby.",
    short: 'Finding a fundi',
    tone: 'active',
  },
  OFFERED: {
    title: "We've found a fundi near you",
    subtitle: "We're waiting for them to confirm they can take your job.",
    short: 'Waiting for a fundi to confirm',
    tone: 'active',
  },
  ACCEPTED: {
    title: 'Your fundi has accepted the request',
    subtitle: "They'll set off to you shortly.",
    short: 'Fundi confirmed',
    tone: 'active',
  },
  EN_ROUTE: {
    title: 'Your fundi is on the way',
    subtitle: 'Keep your phone nearby in case they need directions.',
    short: 'Fundi on the way',
    tone: 'active',
  },
  ARRIVED: {
    title: 'Your fundi has arrived',
    subtitle: "They'll take a look at your vehicle first.",
    short: 'Fundi has arrived',
    tone: 'active',
  },
  DIAGNOSING: {
    title: 'Inspecting your vehicle',
    subtitle: "You'll get an estimate to approve before any work starts.",
    short: 'Inspecting your vehicle',
    tone: 'active',
  },
  QUOTE_SENT: {
    title: 'Your service estimate is ready',
    subtitle: 'Review it and decide whether to go ahead.',
    short: 'Estimate ready',
    tone: 'active',
  },
  IN_PROGRESS: {
    title: 'Your vehicle is being worked on',
    subtitle: "We'll let you know as soon as the work is done.",
    short: 'Work in progress',
    tone: 'active',
  },
  AWAITING_CONFIRMATION: {
    title: 'Your fundi has marked the job complete',
    subtitle: 'Check the work and confirm everything is fine.',
    short: 'Confirm the work',
    tone: 'active',
  },
  PAYMENT_PENDING: {
    title: 'Complete your payment',
    subtitle: 'Pay with M-Pesa to finish the job.',
    short: 'Payment due',
    tone: 'active',
  },
  PAID: {
    title: 'Payment received',
    subtitle: "Thanks! We're wrapping up your job.",
    short: 'Paid',
    tone: 'success',
  },
  COMPLETED: {
    title: 'Service completed',
    subtitle: 'Thanks for using Fundi-X.',
    short: 'Completed',
    tone: 'success',
  },
  CANCELLED: {
    title: 'Request cancelled',
    subtitle: 'This job is closed. You can request help again any time.',
    short: 'Cancelled',
    tone: 'stopped',
  },
  DISPUTED: {
    title: "We're looking into it",
    subtitle:
      'Fundi-X support is reviewing your report and will contact you shortly.',
    short: 'Under review',
    tone: 'warning',
  },
};

export function customerStatusView(status: JobStatus): CustomerStatusView {
  return CUSTOMER_STATUS[status];
}

const CANCELLATION_VIEW: Record<
  NonNullable<Job['cancellation']>['reason'],
  Pick<CustomerStatusView, 'title' | 'subtitle'>
> = {
  customer_cancelled: {
    title: 'You cancelled this request',
    subtitle: "You haven't been charged. You can request help again any time.",
  },
  provider_cancelled: {
    title: 'Your fundi had to cancel',
    subtitle:
      "Sorry about that. You haven't been charged. We can find you another fundi now.",
  },
  no_provider_available: {
    title: 'No fundi was available',
    subtitle:
      "Everyone nearby is busy right now. You haven't been charged. Please try again in a few minutes.",
  },
  quote_rejected: {
    title: 'You declined the estimate',
    subtitle: 'There was nothing to pay, so this job is now closed.',
  },
  dispute_resolved: {
    title: 'Job closed by support',
    subtitle: 'Fundi-X support closed this job after reviewing your report.',
  },
};

/**
 * The status view adjusted for what else we know about the job. The same
 * status can need different words: DIAGNOSING the first time means
 * "inspecting", but after a quote was withdrawn it means "revising".
 */
export function customerJobView(job: Job): CustomerStatusView {
  const base = CUSTOMER_STATUS[job.status];

  if (job.status === 'CANCELLED' && job.cancellation) {
    return { ...base, ...CANCELLATION_VIEW[job.cancellation.reason] };
  }
  if (job.status === 'DIAGNOSING' && job.quoteId) {
    return {
      ...base,
      title: 'Your fundi is updating the estimate',
      subtitle: "You'll get the new estimate to review in a moment.",
      short: 'Updating estimate',
    };
  }
  if (
    job.status === 'PAYMENT_PENDING' &&
    job.chargeType === 'INSPECTION_ONLY'
  ) {
    return {
      ...base,
      subtitle:
        'You declined the estimate, so you only pay the call-out and inspection fee.',
    };
  }
  if (job.status === 'IN_PROGRESS' && job.dispute?.resolution) {
    return {
      ...base,
      title: 'Your fundi is fixing the issue',
      subtitle: job.dispute.resolution,
    };
  }
  return base;
}

/** Tells the customer what happened to a failed M-Pesa payment. */
export function paymentFailureText(reason?: PaymentFailureReason): string {
  switch (reason) {
    case 'cancelled_by_user':
      return 'The M-Pesa request was cancelled on your phone.';
    case 'insufficient_funds':
      return "M-Pesa couldn't complete the payment: insufficient balance.";
    case 'timeout':
      return "We didn't get a response from your phone in time.";
    default:
      return "The payment didn't go through.";
  }
}

/** The main road a job travels, used to draw progress. */
const HAPPY_PATH: JobStatus[] = [
  'SEARCHING',
  'OFFERED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_SENT',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'PAYMENT_PENDING',
  'PAID',
  'COMPLETED',
];

/** 0 to 1. Statuses off the main road (cancelled, disputed) show none. */
export function jobProgress(status: JobStatus): number {
  const index = HAPPY_PATH.indexOf(status);
  return index < 0 ? 0 : (index + 1) / HAPPY_PATH.length;
}
