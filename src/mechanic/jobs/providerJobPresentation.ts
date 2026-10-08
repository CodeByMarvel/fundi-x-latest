import { Job, JobStatus } from '../../domain/jobs/types';
import { getCategory } from '../../customer/request/data/categories';
import { QUESTIONS } from '../../customer/request/data/questions';
import { Drivability, Urgency } from '../../customer/request/types';
import { formatDay } from '../../customer/request/steps/UrgencyStep';
import { colors } from '../../shared/theme/colors';

/**
 * What the provider reads for each job status. The same statuses the
 * customer sees, worded for the person doing the work.
 */
const PROVIDER_STATUS: Record<JobStatus, string> = {
  SEARCHING: 'Looking for a provider',
  OFFERED: 'New job request',
  ACCEPTED: 'Accepted · head out when ready',
  EN_ROUTE: 'On your way to the customer',
  ARRIVED: 'At the vehicle',
  DIAGNOSING: 'Inspecting the vehicle',
  QUOTE_SENT: 'Waiting for the customer to approve your quote',
  IN_PROGRESS: 'Work in progress',
  AWAITING_CONFIRMATION: 'Waiting for the customer to confirm',
  PAYMENT_PENDING: 'Waiting for payment',
  PAID: 'Payment received',
  COMPLETED: 'Job completed',
  CANCELLED: 'Job cancelled',
  DISPUTED: 'Customer raised an issue',
};

export function providerStatusText(status: JobStatus): string {
  return PROVIDER_STATUS[status];
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
