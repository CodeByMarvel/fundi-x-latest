import { CancellationReason, Job, JobStatus } from '../../domain/jobs/types';
import { getCategory } from '../../customer/request/data/categories';
import { QUESTIONS } from '../../customer/request/data/questions';
import { Drivability, Urgency } from '../../customer/request/types';
import { formatDay } from '../../customer/request/steps/UrgencyStep';
import type { PillTone } from '../../shared/components/StatusPill';
import { colors } from '../../shared/theme/colors';

export type ProviderStatusView = {
  title: string;
  /** What the provider should do next, or what they're waiting for. */
  hint: string;
  tone: PillTone;
};

/**
 * What the provider reads for each job status. The same statuses the
 * customer sees, worded for the person doing the work.
 */
const PROVIDER_STATUS: Record<JobStatus, ProviderStatusView> = {
  SEARCHING: {
    title: 'Back to searching',
    hint: 'This job is being offered to other fundis.',
    tone: 'stopped',
  },
  OFFERED: {
    title: 'New job request',
    hint: 'Accept it before the offer runs out.',
    tone: 'active',
  },
  ACCEPTED: {
    title: 'Job accepted',
    hint: "Tap “I'm on my way” when you set off.",
    tone: 'active',
  },
  EN_ROUTE: {
    title: 'On your way',
    hint: 'The customer can see you are coming.',
    tone: 'active',
  },
  ARRIVED: {
    title: 'At the vehicle',
    hint: 'Start the inspection when you begin looking at the car.',
    tone: 'active',
  },
  DIAGNOSING: {
    title: 'Inspecting the vehicle',
    hint: 'Send a quote once you know what needs doing.',
    tone: 'active',
  },
  QUOTE_SENT: {
    title: 'Quote sent',
    hint: 'Waiting for the customer to approve it. Don’t start work yet.',
    tone: 'warning',
  },
  IN_PROGRESS: {
    title: 'Work in progress',
    hint: 'Mark the work complete when you’re done.',
    tone: 'active',
  },
  AWAITING_CONFIRMATION: {
    title: 'Waiting for the customer',
    hint: 'They’re checking the work before paying.',
    tone: 'warning',
  },
  PAYMENT_PENDING: {
    title: 'Waiting for payment',
    hint: 'The customer is paying with M-Pesa.',
    tone: 'warning',
  },
  PAID: {
    title: 'Payment received',
    hint: 'Your earnings are on the way.',
    tone: 'success',
  },
  COMPLETED: {
    title: 'Job completed',
    hint: 'Nice work!',
    tone: 'success',
  },
  CANCELLED: {
    title: 'Job cancelled',
    hint: 'Nothing more to do on this job.',
    tone: 'stopped',
  },
  DISPUTED: {
    title: 'Customer reported a problem',
    hint: 'Fundi-X support is reviewing it and will contact you.',
    tone: 'warning',
  },
};

const CANCELLED_BY: Record<CancellationReason, string> = {
  customer_cancelled: 'The customer cancelled this job.',
  provider_cancelled: 'You cancelled this job.',
  no_provider_available: 'No fundi was available.',
  quote_rejected: 'The customer declined your quote.',
  dispute_resolved: 'Support closed this job after a dispute.',
};

/** The status view, adjusted for what else we know about the job. */
export function providerJobView(job: Job): ProviderStatusView {
  const base = PROVIDER_STATUS[job.status];
  if (job.status === 'CANCELLED' && job.cancellation) {
    return { ...base, hint: CANCELLED_BY[job.cancellation.reason] };
  }
  if (
    job.status === 'PAYMENT_PENDING' &&
    job.chargeType === 'INSPECTION_ONLY'
  ) {
    return {
      ...base,
      title: 'Quote declined',
      hint: 'The customer is paying the call-out and inspection fee only.',
    };
  }
  if (job.status === 'IN_PROGRESS' && job.dispute?.resolution) {
    return {
      ...base,
      title: 'Fix the reported problem',
      hint: `Support asked you to sort out: “${job.dispute.reason}”`,
    };
  }
  return base;
}

const DRIVABILITY: Record<Drivability, { label: string; color: string }> = {
  safe: { label: 'Drivable', color: colors.success },
  caution: { label: 'Drivable with caution', color: colors.warning },
  cannot: { label: 'Not drivable', color: colors.error },
  unsure: { label: 'Drivability unknown', color: colors.inactive },
};

export function drivabilityView(drivability: Drivability) {
  return DRIVABILITY[drivability];
}

export function urgencyText(urgency: Urgency, job: Pick<Job, 'scheduledFor'>) {
  switch (urgency) {
    case 'now':
      return 'As soon as possible';
    case 'today':
      return 'Today';
    case 'scheduled':
      return job.scheduledFor
        ? `${formatDay(job.scheduledFor.date)} at ${job.scheduledFor.time}`
        : 'Scheduled';
  }
}

/** The answers to the category's first question, e.g. "Strange noise". */
export function symptomLabels(job: Job): string[] {
  const firstQuestion = getCategory(job.categoryId)?.questions[0];
  if (!firstQuestion) {
    return [];
  }
  const picked = job.answers[firstQuestion] ?? [];
  return QUESTIONS[firstQuestion].options
    .filter(o => picked.includes(o.id))
    .map(o => o.label);
}
