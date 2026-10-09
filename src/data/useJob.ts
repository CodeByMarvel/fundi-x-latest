import { useMemo, useSyncExternalStore } from 'react';
import { balanceDue, totalPaid, totalRefunded } from '../domain/billing/ledger';
import { isTerminalStatus } from '../domain/jobs/transitions';
import { Job } from '../domain/jobs/types';
import { billingService, jobRepository, providerRepository } from './backend';

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

/** The unfinished job this provider is assigned to, if any. */
export function useProviderCurrentJob(providerId: string) {
  return useJobFromList(jobs =>
    jobs.find(
      job => job.providerId === providerId && !isTerminalStatus(job.status),
    ),
  );
}

/**
 * Every job this provider worked on, newest first. Filtering makes a new
 * array, which must not happen inside the store snapshot (React would see a
 * "new" value on every check and loop), so it's done afterwards with useMemo.
 */
export function useProviderJobs(providerId: string) {
  const jobs = useJobs();
  const releases = useSyncExternalStore(
    billingService.subscribe,
    billingService.getReleasesSnapshot,
  );
  return useMemo(() => {
    // Includes jobs that ended with a payout but no current assignment.
    const paidJobIds = new Set(
      releases.filter(r => r.providerId === providerId).map(r => r.jobId),
    );
    return [...jobs]
      .reverse()
      .filter(job => job.providerId === providerId || paidJobIds.has(job.id));
  }, [jobs, releases, providerId]);
}

export function useQuote(quoteId: string | undefined) {
  return useSyncExternalStore(jobRepository.subscribe, () =>
    quoteId ? jobRepository.getQuoteSnapshot(quoteId) : undefined,
  );
}

/** A job's additional quotes, oldest first. */
export function useAdditionalQuotes(jobId: string) {
  const quotes = useSyncExternalStore(
    jobRepository.subscribe,
    jobRepository.getQuotesSnapshot,
  );
  return useMemo(
    () => quotes.filter(q => q.jobId === jobId && q.kind === 'ADDITIONAL'),
    [quotes, jobId],
  );
}

function useBilling() {
  const sub = billingService.subscribe;
  return {
    charges: useSyncExternalStore(sub, billingService.getChargesSnapshot),
    payments: useSyncExternalStore(sub, billingService.getPaymentsSnapshot),
    refunds: useSyncExternalStore(sub, billingService.getRefundsSnapshot),
    releases: useSyncExternalStore(sub, billingService.getReleasesSnapshot),
  };
}

/**
 * Everything about one job's money, worked out from the ledger records:
 * what was charged, paid, refunded and paid out, and what's still owed.
 */
export function useJobLedger(jobId: string) {
  const { charges, payments, refunds, releases } = useBilling();
  return useMemo(() => {
    const paid = payments.filter(
      p => p.jobId === jobId && p.status === 'SUCCESS',
    );
    const jobRefunds = refunds.filter(r => r.jobId === jobId);
    return {
      charges: charges.filter(c => c.jobId === jobId),
      payments: paid,
      latestPayment: [...payments].reverse().find(p => p.jobId === jobId),
      refunds: jobRefunds,
      release: releases.find(r => r.jobId === jobId),
      callOutDue: balanceDue(charges, payments, jobId, 'CALL_OUT'),
      serviceDue: balanceDue(charges, payments, jobId, 'SERVICE'),
      totalPaid: totalPaid(payments, jobId),
      totalRefunded: totalRefunded(refunds, jobId),
    };
  }, [charges, payments, refunds, releases, jobId]);
}

/** Payouts to this provider, newest first. */
export function useProviderReleases(providerId: string) {
  const { releases } = useBilling();
  return useMemo(
    () => [...releases].reverse().filter(r => r.providerId === providerId),
    [releases, providerId],
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
