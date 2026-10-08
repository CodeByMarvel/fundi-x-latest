import { CreateJobInput, Job, JobEvent } from './types';

/**
 * Everything the app can ask of "the backend" about jobs. Screens depend on
 * this interface only, so a mock and a real API client are interchangeable.
 *
 * Commands are async because they will be network calls. Screens read jobs
 * through the synchronous snapshot + subscribe pair, which reflects whatever
 * the repository currently knows and announces every change.
 */
export interface JobRepository {
  createJob(input: CreateJobInput): Promise<Job>;
  /** Fetches the latest copy of a job. */
  getJob(jobId: string): Promise<Job | undefined>;
  /** The job's audit trail, oldest first. */
  getJobEvents(jobId: string): Promise<JobEvent[]>;
  /**
   * The customer cancels their job. Rejects with JobTransitionError if the
   * job has already moved past the point where cancelling is allowed.
   */
  cancelJob(jobId: string): Promise<Job>;

  /**
   * A provider takes the job they've been offered. Rejects if the offer has
   * moved on or was made to someone else.
   */
  acceptOffer(jobId: string, providerId: string): Promise<Job>;
  /** A provider turns the offer down; the job goes back to searching. */
  declineOffer(jobId: string, providerId: string): Promise<Job>;

  /**
   * The job as last seen, without waiting. Returns the same object until the
   * job changes, which is what lets React tell whether to re-render.
   */
  getJobSnapshot(jobId: string): Job | undefined;
  /** Every job known so far, oldest first. Same array until something changes. */
  getJobsSnapshot(): readonly Job[];
  /** Calls `listener` after any job changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
