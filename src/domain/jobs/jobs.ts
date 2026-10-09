import { Job, JobRequestDetails } from './types';

/** The same request again, e.g. after nobody was available. */
export function requestDetailsFromJob(job: Job): JobRequestDetails {
  return {
    requestType: job.requestType,
    categoryId: job.categoryId,
    vehicle: job.vehicle,
    answers: job.answers,
    description: job.description,
    drivability: job.drivability,
    location: job.location,
    urgency: job.urgency,
    ...(job.scheduledFor && { scheduledFor: job.scheduledFor }),
  };
}
