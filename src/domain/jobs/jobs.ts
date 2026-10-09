import { CreateJobInput, Job } from './types';

/** The same request again, e.g. after a provider cancelled. */
export function createInputFromJob(job: Job): CreateJobInput {
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
