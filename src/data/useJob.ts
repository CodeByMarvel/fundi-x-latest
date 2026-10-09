import { useMemo, useSyncExternalStore } from 'react';
import { isTerminalStatus } from '../domain/jobs/transitions';
import { Job } from '../domain/jobs/types';
import { jobRepository, paymentService, providerRepository } from './backend';

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

/** Every job, oldest first. */
export function useJobs() {
  return useSyncExternalStore(
    jobRepository.subscribe,
    jobRepository.getJobsSnapshot,
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

/** The customer's newest completed job, for "Recent service". */
export function useLatestCompletedJob() {
  return useJobFromList(jobs =>
    [...jobs].reverse().find(job => job.status === 'COMPLETED'),
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

/**
 * Every job this provider took, newest first. Filtering makes a new array,
 * which must not happen inside the store snapshot (React would see a "new"
 * value on every check and loop), so it's done afterwards with useMemo.
 */
export function useProviderJobs(providerId: string) {
  const jobs = useJobs();
  return useMemo(
    () => [...jobs].reverse().filter(job => job.providerId === providerId),
    [jobs, providerId],
  );
}

export function useQuote(quoteId: string | undefined) {
  return useSyncExternalStore(jobRepository.subscribe, () =>
    quoteId ? jobRepository.getQuoteSnapshot(quoteId) : undefined,
  );
}

/** The most recent payment attempt for a job. */
export function useLatestPayment(jobId: string) {
  return useSyncExternalStore(paymentService.subscribe, () =>
    [...paymentService.getPaymentsSnapshot()]
      .reverse()
      .find(payment => payment.jobId === jobId),
  );
}

export function useProvider(providerId: string | undefined) {
  return useSyncExternalStore(providerRepository.subscribe, () =>
    providerId ? providerRepository.getProviderSnapshot(providerId) : undefined,
  );
}

export function useProviders() {
  return useSyncExternalStore(
    providerRepository.subscribe,
    providerRepository.getProvidersSnapshot,
  );
}
