import { useSyncExternalStore } from 'react';
import { isTerminalStatus } from '../domain/jobs/transitions';
import { Job } from '../domain/jobs/types';
import { jobRepository } from './jobRepository';

/**
 * Re-renders the component whenever the picked job changes. `pick` must
 * return a job from the list as-is (not a copy), so React can see when
 * nothing changed.
 */
function useJobFromList(pick: (jobs: readonly Job[]) => Job | undefined) {
  return useSyncExternalStore(jobRepository.subscribe, () =>
    pick(jobRepository.getJobsSnapshot()),
  );
}

/**
 * The current state of a job, re-rendering the component whenever it changes,
 * no matter which screen or side of the app changed it.
 */
export function useJob(jobId: string) {
  return useSyncExternalStore(jobRepository.subscribe, () =>
    jobRepository.getJobSnapshot(jobId),
  );
}

/**
 * The customer's newest unfinished job, if they have one. A real backend only
 * returns the signed-in customer's own jobs, so no filtering by customer here.
 */
export function useActiveJob() {
  return useJobFromList(jobs =>
    [...jobs].reverse().find(job => !isTerminalStatus(job.status)),
  );
}

/** A job currently waiting for this provider to accept or decline. */
export function useOfferForProvider(providerId: string) {
  return useJobFromList(jobs =>
    jobs.find(
      job => job.status === 'OFFERED' && job.offeredProviderId === providerId,
    ),
  );
}

/** The unfinished job this provider has accepted, if any. */
export function useProviderCurrentJob(providerId: string) {
  return useJobFromList(jobs =>
    jobs.find(
      job => job.providerId === providerId && !isTerminalStatus(job.status),
    ),
  );
}
