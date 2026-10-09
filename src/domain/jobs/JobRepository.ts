import { Quote, QuoteItemInput } from '../quotes/types';
import { CreateJobInput, Job, JobEvent } from './types';

/**
 * Everything the app can ask of "the backend" about jobs. Screens depend on
 * this interface only, so a mock and a real API client are interchangeable.
 *
 * Commands are async because they will be network calls. They reject with
 * JobTransitionError when the job has moved on to a status where the action
 * no longer makes sense, and with a plain Error for anything else (e.g. a
 * provider acting on someone else's job).
 *
 * Screens read data through the synchronous snapshot + subscribe pair, which
 * reflects whatever the repository currently knows and announces every
 * change.
 *
 * Methods taking a `providerId` are the provider acting; the rest are the
 * customer. A real API would know who's calling from the login token.
 */
export interface JobRepository {
  // ---- Customer ----
  createJob(input: CreateJobInput): Promise<Job>;
  cancelJob(jobId: string): Promise<Job>;
  /** `quoteId` guards against approving a quote that has since been revised. */
  approveQuote(jobId: string, quoteId: string): Promise<Job>;
  /** The customer still owes any call-out/inspection fee on the quote. */
  rejectQuote(jobId: string, quoteId: string): Promise<Job>;
  confirmCompletion(jobId: string): Promise<Job>;
  disputeCompletion(jobId: string, reason: string): Promise<Job>;
  submitRating(jobId: string, stars: number, comment: string): Promise<Job>;

  // ---- Provider ----
  acceptOffer(jobId: string, providerId: string): Promise<Job>;
  declineOffer(jobId: string, providerId: string): Promise<Job>;
  startTrip(jobId: string, providerId: string): Promise<Job>;
  markArrived(jobId: string, providerId: string): Promise<Job>;
  startInspection(jobId: string, providerId: string): Promise<Job>;
  sendQuote(
    jobId: string,
    providerId: string,
    items: QuoteItemInput[],
    note?: string,
  ): Promise<Quote>;
  /** Withdraws the pending quote so a corrected one can be sent. */
  reviseQuote(jobId: string, providerId: string): Promise<Job>;
  markWorkComplete(
    jobId: string,
    providerId: string,
    summary: string,
  ): Promise<Job>;
  providerCancelJob(
    jobId: string,
    providerId: string,
    note: string,
  ): Promise<Job>;

  // ---- Reads ----
  /** Fetches the latest copy of a job. */
  getJob(jobId: string): Promise<Job | undefined>;
  /** The job's audit trail, oldest first. */
  getJobEvents(jobId: string): Promise<JobEvent[]>;
  /**
   * The job as last seen, without waiting. Returns the same object until the
   * job changes, which is what lets React tell whether to re-render.
   */
  getJobSnapshot(jobId: string): Job | undefined;
  /** Every job known so far, oldest first. Same array until something changes. */
  getJobsSnapshot(): readonly Job[];
  getQuoteSnapshot(quoteId: string): Quote | undefined;
  /** Calls `listener` after anything changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
