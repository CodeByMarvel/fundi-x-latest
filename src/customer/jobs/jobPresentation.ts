import { PaymentFailureReason } from '../../domain/billing/types';
import { CancellationReason, Job, JobStatus } from '../../domain/jobs/types';
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
  CALL_OUT_PAYMENT_PENDING: {
    title: 'Pay the call-out to book',
    subtitle:
      'The call-out covers your fundi’s trip and inspection. We start looking as soon as it’s paid.',
    short: 'Call-out payment due',
    tone: 'warning',
  },
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
    subtitle: 'Please meet them at your vehicle.',
    short: 'Fundi has arrived',
    tone: 'active',
  },
  DIAGNOSING: {
    title: 'Inspecting your vehicle',
    subtitle: "You'll get an estimate to approve before any repair starts.",
    short: 'Inspecting your vehicle',
    tone: 'active',
  },
  QUOTE_SENT: {
    title: 'Your repair estimate is ready',
    subtitle: 'Review it and decide whether to go ahead.',
    short: 'Estimate ready',
    tone: 'warning',
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
    tone: 'warning',
  },
  PAYMENT_PENDING: {
    title: 'Complete your payment',
    subtitle: 'Pay the rest with M-Pesa to finish the job.',
    short: 'Payment due',
    tone: 'warning',
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
      'Fundi-X support is reviewing your report. You won’t pay anything more until it’s sorted.',
    short: 'Under review',
    tone: 'warning',
  },
};

export function customerStatusView(status: JobStatus): CustomerStatusView {
  return CUSTOMER_STATUS[status];
}

const CANCELLATION_VIEW: Record<
  CancellationReason,
  Pick<CustomerStatusView, 'title' | 'subtitle'>
> = {
  call_out_unpaid: {
    title: 'Booking expired',
    subtitle: "The call-out wasn't paid within 30 minutes, so we closed it.",
  },
  customer_cancelled: {
    title: 'You cancelled this request',
    subtitle: 'You can request help again any time.',
  },
  no_provider_available: {
    title: 'No fundi was available',
    subtitle:
      'Everyone nearby is busy right now. Your call-out is refunded. Please try again in a few minutes.',
  },
  quote_declined: {
    title: 'You declined the estimate',
    subtitle:
      'No repair was done. The call-out covered your fundi’s visit and inspection.',
  },
  customer_no_show: {
    title: 'Your fundi couldn’t find you',
    subtitle:
      'They waited 15 minutes at the location. The call-out covered their trip.',
  },
  dispute_closed: {
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
  if (
    (job.status === 'SEARCHING' || job.status === 'OFFERED') &&
    job.reassignment
  ) {
    return {
      ...base,
      title: 'Finding you another fundi',
      subtitle:
        'Your previous fundi had to withdraw. Your call-out is safe with Fundi-X while we find someone else.',
      short: 'Finding another fundi',
    };
  }
  if (job.status === 'ARRIVED' && job.pricingMode === 'FIXED') {
    return { ...base, subtitle: "They'll start the service shortly." };
  }
  if (job.status === 'DIAGNOSING' && job.baseQuoteId) {
    return {
      ...base,
      title: 'Your fundi is updating the estimate',
      subtitle: "You'll get the new estimate to review in a moment.",
      short: 'Updating estimate',
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
  'CALL_OUT_PAYMENT_PENDING',
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
  'COMPLETED',
];

/** 0 to 1. Statuses off the main road (cancelled, disputed) show none. */
export function jobProgress(status: JobStatus): number {
  const index = HAPPY_PATH.indexOf(status);
  return index < 0 ? 0 : (index + 1) / HAPPY_PATH.length;
}
