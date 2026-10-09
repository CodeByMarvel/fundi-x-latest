import { JobRepository } from '../../domain/jobs/JobRepository';
import { JobStatus } from '../../domain/jobs/types';
import { sampleQuoteItems } from '../../domain/quotes/quotes';

/** How long a simulated provider takes for each step. */
export const BOT_TIMINGS = {
  accept: 3000,
  startTrip: 2000,
  arrive: 10_000,
  inspect: 2000,
  quote: 5000,
  finishWork: 8000,
};

/**
 * Plays the providers nobody is logged in as, so a customer's job keeps
 * moving even if Brian (the mechanic side) is offline or declines.
 *
 * Bots only use the public JobRepository API, exactly like the mechanic
 * screens do. If a job has moved on by the time a bot acts (say the customer
 * cancelled), the repository refuses and the bot simply lets it go.
 */
export function startProviderBots(jobs: JobRepository, botIds: string[]) {
  /** The status each job had when we last looked, to react once per change. */
  const seen = new Map<string, JobStatus>();
  const isBot = (providerId?: string) =>
    !!providerId && botIds.includes(providerId);

  const later = (ms: number, action: () => Promise<unknown>) =>
    setTimeout(() => {
      action().catch(() => {});
    }, ms);

  const review = () => {
    for (const job of jobs.getJobsSnapshot()) {
      if (seen.get(job.id) === job.status) {
        continue;
      }
      seen.set(job.id, job.status);

      const offeredTo = job.offeredProviderId;
      if (job.status === 'OFFERED' && offeredTo && isBot(offeredTo)) {
        later(BOT_TIMINGS.accept, () => jobs.acceptOffer(job.id, offeredTo));
        continue;
      }

      const providerId = job.providerId;
      if (!providerId || !isBot(providerId)) {
        continue;
      }
      switch (job.status) {
        case 'ACCEPTED':
          later(BOT_TIMINGS.startTrip, () =>
            jobs.startTrip(job.id, providerId),
          );
          break;
        case 'EN_ROUTE':
          later(BOT_TIMINGS.arrive, () => jobs.markArrived(job.id, providerId));
          break;
        case 'ARRIVED':
          // Fixed-price work was agreed at booking; anything else needs a look first.
          later(BOT_TIMINGS.inspect, () =>
            job.pricingMode === 'FIXED'
              ? jobs.startService(job.id, providerId)
              : jobs.startInspection(job.id, providerId),
          );
          break;
        case 'DIAGNOSING':
          later(BOT_TIMINGS.quote, () =>
            jobs.sendQuote(
              job.id,
              providerId,
              sampleQuoteItems(job.categoryId),
              "I've checked the vehicle. This should sort it out.",
            ),
          );
          break;
        case 'IN_PROGRESS':
          later(BOT_TIMINGS.finishWork, () =>
            jobs.markWorkComplete(
              job.id,
              providerId,
              'Work done as quoted. Tested and working properly.',
            ),
          );
          break;
      }
    }
  };

  return jobs.subscribe(review);
}
