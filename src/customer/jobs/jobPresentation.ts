import { JobStatus } from '../../domain/jobs/types';

/** How a status should feel: still moving, finished well, or stopped. */
export type StatusTone = 'active' | 'success' | 'stopped';

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
    subtitle: 'Our team will contact you to resolve the issue.',
    short: 'Under review',
    tone: 'stopped',
  },
};

export function customerStatusView(status: JobStatus): CustomerStatusView {
  return CUSTOMER_STATUS[status];
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
