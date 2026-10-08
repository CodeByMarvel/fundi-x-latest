import { JobRepository } from '../../domain/jobs/JobRepository';
import { applyTransition } from '../../domain/jobs/transitions';
import {
  CreateJobInput,
  Job,
  JobActor,
  JobEvent,
  JobEventMetadata,
  JobStatus,
} from '../../domain/jobs/types';
import { delay } from './delay';
import { mockProviders } from './mockProviders';

/** Until login exists, every job belongs to this customer. */
const MOCK_CUSTOMER_ID = 'customer-1';

/** How long the simulated backend takes to find a provider. */
export const MATCHING_DELAY_MS = 1500;

/** Fields a transition may set alongside the new status. */
type JobChanges = Partial<Pick<Job, 'providerId' | 'offeredProviderId'>>;

/**
 * An in-memory stand-in for the jobs backend. It lives outside React, so its
 * data survives screens unmounting and switching between customer and
 * mechanic sides.
 *
 * Built as a factory (not a class) so methods can be passed around, e.g. to
 * useSyncExternalStore, without losing `this`.
 */
export function createMockJobRepository(): JobRepository {
  const jobs = new Map<string, Job>();
  const events = new Map<string, JobEvent[]>();
  const listeners = new Set<() => void>();
  let nextId = 1;
  /** Rebuilt only when a job changes, so readers get a stable array. */
  let jobList: readonly Job[] = [];

  const makeId = (prefix: string) => `${prefix}-${nextId++}`;

  const notify = () => listeners.forEach(listener => listener());

  /** Stores a job change together with the event that explains it. */
  const save = (job: Job, event: JobEvent) => {
    jobs.set(job.id, job);
    jobList = [...jobs.values()];
    events.set(job.id, [...(events.get(job.id) ?? []), event]);
    notify();
  };

  /** Throws unless `jobId` is currently offered to `providerId`. */
  const assertOfferedTo = (jobId: string, providerId: string) => {
    if (jobs.get(jobId)?.offeredProviderId !== providerId) {
      throw new Error(`Job ${jobId} is not offered to ${providerId}`);
    }
  };

  /** Providers this job has already been offered to, in any earlier round. */
  const previouslyOffered = (jobId: string) =>
    (events.get(jobId) ?? [])
      .filter(e => e.toStatus === 'OFFERED')
      .map(e => e.metadata?.providerId);

  /**
   * The only way the mock changes a job's status. The transition rules are
   * checked against the job as it is *now*, which may differ from what the
   * caller saw when it started (e.g. the customer cancelled meanwhile).
   */
  const transitionJob = (
    jobId: string,
    to: JobStatus,
    actor: JobActor,
    {
      metadata,
      changes,
    }: { metadata?: JobEventMetadata; changes?: JobChanges } = {},
  ): Job => {
    const current = jobs.get(jobId);
    if (!current) {
      throw new Error(`Job ${jobId} not found`);
    }

    const { job, event } = applyTransition(current, to, actor, {
      now: new Date().toISOString(),
      eventId: makeId('evt'),
      metadata,
    });
    const next: Job = { ...job, ...changes };
    if (to !== 'OFFERED') {
      delete next.offeredProviderId;
    }

    save(next, event);
    return next;
  };

  /**
   * Simulates the backend looking for a provider in the background. Picks
   * the nearest one who hasn't already been asked, so the demo is
   * predictable and a declined job never bounces back to the same fundi.
   */
  const startMatching = (jobId: string) => {
    setTimeout(() => {
      // The job may have been cancelled while we were "searching".
      if (jobs.get(jobId)?.status !== 'SEARCHING') {
        return;
      }
      const asked = previouslyOffered(jobId);
      const [nearest] = mockProviders
        .filter(p => !asked.includes(p.id))
        .sort((a, b) => a.distanceKm - b.distanceKm);

      if (!nearest) {
        transitionJob(jobId, 'CANCELLED', 'SYSTEM', {
          metadata: { reason: 'no_provider_available' },
        });
        return;
      }
      transitionJob(jobId, 'OFFERED', 'SYSTEM', {
        metadata: { providerId: nearest.id },
        changes: { offeredProviderId: nearest.id },
      });
    }, MATCHING_DELAY_MS);
  };

  return {
    async createJob(input: CreateJobInput) {
      await delay(500);

      const now = new Date().toISOString();
      const job: Job = {
        ...input,
        id: makeId('job'),
        customerId: MOCK_CUSTOMER_ID,
        status: 'SEARCHING',
        createdAt: now,
        updatedAt: now,
      };
      save(job, {
        id: makeId('evt'),
        jobId: job.id,
        fromStatus: null,
        toStatus: 'SEARCHING',
        actor: 'CUSTOMER',
        createdAt: now,
      });
      startMatching(job.id);
      return job;
    },

    async getJob(jobId: string) {
      await delay(300);
      return jobs.get(jobId);
    },

    async getJobEvents(jobId: string) {
      await delay(300);
      return events.get(jobId) ?? [];
    },

    async cancelJob(jobId: string) {
      await delay(500);
      return transitionJob(jobId, 'CANCELLED', 'CUSTOMER');
    },

    async acceptOffer(jobId: string, providerId: string) {
      await delay(500);
      assertOfferedTo(jobId, providerId);
      return transitionJob(jobId, 'ACCEPTED', 'PROVIDER', {
        metadata: { providerId },
        changes: { providerId },
      });
    },

    async declineOffer(jobId: string, providerId: string) {
      await delay(500);
      assertOfferedTo(jobId, providerId);
      const job = transitionJob(jobId, 'SEARCHING', 'PROVIDER', {
        metadata: { providerId, reason: 'declined' },
      });
      startMatching(jobId);
      return job;
    },

    getJobSnapshot(jobId: string) {
      return jobs.get(jobId);
    },

    getJobsSnapshot() {
      return jobList;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
