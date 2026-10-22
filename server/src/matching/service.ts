import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import {
  TRANSITIONS,
  applyTransition,
  isTerminalStatus,
} from '../../../src/domain/jobs/transitions';
import type { Job, JobStatus } from '../../../src/domain/jobs/types';
import type { Database, Tx } from '../db/client';
import {
  jobEvents,
  jobMatching,
  jobs,
  providers,
  reliabilityEvents,
  users,
} from '../db/schema';
import { newId } from '../ids';
import { settle } from '../jobs/service';
import { saveJob } from '../jobs/store';
import { getSetting } from '../settings';
import { scheduleTimer } from '../timers/schedule';
import { cellsWithin, matchingCell, metresBetween, ringsApart } from './h3';

/**
 * Matching (docs/job-flow.md §4): find one provider for a SEARCHING job
 * and offer it to them. Search starts in the job's own H3 cell (ring 0)
 * and each round, `matching_round_seconds` apart, looks one ring further,
 * up to `matching_max_ring`. Nobody by then: the job is cancelled
 * (`no_provider_available`) and the call-out refunded.
 *
 * Everything here runs inside the caller's transaction with the job row
 * locked, so a customer cancelling mid-search simply waits its turn.
 */

/** A position older than this is ignored: the phone may be off, or far away by now. */
export const PROVIDER_LOCATION_MAX_AGE_MS = 5 * 60_000;

/** Reliability events in this window lower a provider's place in the queue. */
export const RELIABILITY_WINDOW_MS = 30 * 24 * 60 * 60_000;

const FINISHED = (Object.keys(TRANSITIONS) as JobStatus[]).filter(isTerminalStatus);

/**
 * The call-out reached escrow: the job starts SEARCHING and the first
 * round runs at once. Called by payment confirmation (M-Pesa); `job` must
 * be locked and CALL_OUT_PAYMENT_PENDING.
 */
export async function callOutPaid(tx: Tx, job: Job, now: Date) {
  const { job: searching, event } = applyTransition(job, 'SEARCHING', 'SYSTEM', {
    now: now.toISOString(),
    eventId: newId('evt'),
  });
  await saveJob(tx, searching);
  await tx.insert(jobEvents).values({ ...event, createdAt: now });
  return startMatching(tx, searching, now);
}

/**
 * Starts the search for a job that just reached SEARCHING (the call-out is
 * in escrow, or the assigned provider withdrew): from ring 0 again.
 */
export async function startMatching(tx: Tx, job: Job, now: Date) {
  await tx
    .insert(jobMatching)
    .values({ jobId: job.id, ring: 0, startedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: jobMatching.jobId,
      set: { ring: 0, startedAt: now, updatedAt: now },
    });
  return matchRound(tx, job, now);
}

/**
 * One round: offer the job to the best free provider within the current
 * ring, or widen the search, or give up. `job` must be locked and SEARCHING.
 * Returns the job as it is afterwards.
 */
export async function matchRound(tx: Tx, job: Job, now: Date): Promise<Job> {
  const coords = job.location.coords;
  if (!coords) {
    // Booking requires coordinates, so this is a bug, not a quiet case:
    // the timer fails and shows up on the Engineering page.
    throw new Error(`Job ${job.id} has no coordinates to match from`);
  }
  const maxRing = await getSetting(tx, 'matching_max_ring');
  const [progress] = await tx
    .select({ ring: jobMatching.ring })
    .from(jobMatching)
    .where(eq(jobMatching.jobId, job.id));
  // An admin may have lowered the max since this search started.
  const ring = Math.min(progress?.ring ?? 0, maxRing);

  const candidate = await bestCandidate(tx, job, matchingCell(coords), ring, now);
  if (candidate) {
    return offer(tx, job, candidate, now);
  }
  if (ring < maxRing) {
    await tx
      .update(jobMatching)
      .set({ ring: ring + 1, updatedAt: now })
      .where(eq(jobMatching.jobId, job.id));
    const seconds = await getSetting(tx, 'matching_round_seconds');
    await scheduleTimer(tx, {
      jobId: job.id,
      kind: 'MATCHING_ROUND',
      dueAt: new Date(now.getTime() + seconds * 1000),
      at: now,
    });
    return job;
  }

  const { job: moved, event } = applyTransition(job, 'CANCELLED', 'SYSTEM', {
    now: now.toISOString(),
    eventId: newId('evt'),
    metadata: { reason: 'no_provider_available', ring },
  });
  const next: Job = {
    ...moved,
    cancellation: {
      by: 'SYSTEM',
      reason: 'no_provider_available',
      fromStatus: job.status,
    },
  };
  await saveJob(tx, next);
  await tx.insert(jobEvents).values({ ...event, createdAt: now });
  await settle(tx, next, now);
  return next;
}

type Candidate = {
  id: string;
  /** How many rings from the job's cell. */
  ring: number;
  recentEvents: number;
  rating: number;
  metres: number;
};

/**
 * A provider's average pulled toward 4.5 by five imaginary ratings, so a
 * newcomer with one 5-star job doesn't outrank 4.8 over a hundred jobs,
 * and has no unfair penalty for having none yet.
 */
export const RATING_PRIOR = { stars: 4.5, weight: 5 };
export const rankingRating = (total: number, count: number) =>
  (total + RATING_PRIOR.stars * RATING_PRIOR.weight) / (count + RATING_PRIOR.weight);

/**
 * The provider to offer the job to, or null. Ranked by ring (nearest
 * first), then fewer recent reliability events, then rating, then
 * straight-line distance.
 */
async function bestCandidate(
  tx: Tx,
  job: Job,
  jobCell: string,
  ring: number,
  now: Date,
): Promise<Candidate | null> {
  const coords = job.location.coords!;
  const asked = await askedProviders(tx, job.id);
  const rows = await eligibleProviders(tx, now, {
    cells: cellsWithin(jobCell, ring),
    exclude: asked,
  });
  const ranked = rows
    .map(r => ({
      id: r.id,
      ring: ringsApart(jobCell, r.h3Cell!),
      recentEvents: r.recentEvents,
      rating: rankingRating(r.ratingTotal, r.ratingCount),
      metres: metresBetween(coords, { lat: r.lat!, lng: r.lng! }),
    }))
    .sort(
      (a, b) =>
        a.ring - b.ring ||
        a.recentEvents - b.recentEvents ||
        b.rating - a.rating ||
        a.metres - b.metres,
    );

  for (const candidate of ranked) {
    // Two jobs searching at once could both pick the same free provider.
    // Lock the provider's row (skipping one another search holds right
    // now), then check again with fresh data: whoever got there first has
    // already committed their offer, so the second sees them busy.
    const [locked] = await tx
      .select({ id: providers.userId })
      .from(providers)
      .where(eq(providers.userId, candidate.id))
      .for('update', { skipLocked: true });
    if (!locked) {
      continue;
    }
    const still = await eligibleProviders(tx, now, { only: candidate.id });
    if (still.length > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Providers who could take a job right now: verified, active, online,
 * with a recent position, and not busy (no unfinished job, no open offer).
 */
/**
 * Providers who could take a job right now: online, verified, active, a
 * fresh position, not busy. Also lists "nearby" mechanics for customers.
 */
export function eligibleProviders(
  tx: Tx | Database,
  now: Date,
  filter: { cells: string[]; exclude: string[] } | { only: string },
) {
  const freshSince = new Date(now.getTime() - PROVIDER_LOCATION_MAX_AGE_MS);
  const eventsSince = new Date(now.getTime() - RELIABILITY_WINDOW_MS);
  const busy = sql`exists (
    select 1 from ${jobs}
    where (${jobs.providerId} = ${providers.userId} or ${jobs.offeredProviderId} = ${providers.userId})
      and ${notInArray(jobs.status, FINISHED)}
  )`;
  return tx
    .select({
      id: providers.userId,
      h3Cell: providers.h3Cell,
      lat: providers.lat,
      lng: providers.lng,
      ratingTotal: providers.ratingTotal,
      ratingCount: providers.ratingCount,
      recentEvents: sql<number>`(
        select count(*) from ${reliabilityEvents}
        where ${reliabilityEvents.providerId} = ${providers.userId}
          and ${reliabilityEvents.createdAt} >= ${eventsSince.toISOString()}
      )`.mapWith(Number),
    })
    .from(providers)
    .innerJoin(users, eq(users.id, providers.userId))
    .where(
      and(
        eq(providers.online, true),
        eq(providers.verification, 'VERIFIED'),
        eq(users.status, 'ACTIVE'),
        gte(providers.locationAt, freshSince),
        sql`not ${busy}`,
        'only' in filter
          ? eq(providers.userId, filter.only)
          : and(
              inArray(providers.h3Cell, filter.cells),
              filter.exclude.length > 0
                ? notInArray(providers.userId, filter.exclude)
                : undefined,
            ),
      ),
    );
}

/** Everyone this job has been offered to, in any round: never asked twice. */
async function askedProviders(tx: Tx, jobId: string) {
  const offers = await tx
    .select({ metadata: jobEvents.metadata })
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, jobId), eq(jobEvents.toStatus, 'OFFERED')));
  return offers
    .map(o => o.metadata?.providerId)
    .filter((id): id is string => typeof id === 'string');
}

async function offer(tx: Tx, job: Job, candidate: Candidate, now: Date) {
  const seconds = await getSetting(tx, 'offer_timeout_seconds');
  const expiresAt = new Date(now.getTime() + seconds * 1000);
  const { job: moved, event } = applyTransition(job, 'OFFERED', 'SYSTEM', {
    now: now.toISOString(),
    eventId: newId('evt'),
    metadata: { providerId: candidate.id, ring: candidate.ring },
  });
  const next: Job = {
    ...moved,
    offeredProviderId: candidate.id,
    offerExpiresAt: expiresAt.toISOString(),
  };
  await saveJob(tx, next);
  await tx.insert(jobEvents).values({ ...event, createdAt: now });
  await scheduleTimer(tx, {
    jobId: job.id,
    kind: 'OFFER_EXPIRY',
    dueAt: expiresAt,
    at: now,
  });
  return next;
}

/**
 * The offer wasn't answered in time: note it against the provider and
 * carry on searching at the same ring (others nearby may be free).
 */
export async function expireOffer(tx: Tx, job: Job, now: Date) {
  const providerId = job.offeredProviderId!;
  const { job: moved, event } = applyTransition(job, 'SEARCHING', 'SYSTEM', {
    now: now.toISOString(),
    eventId: newId('evt'),
    metadata: { providerId, reason: 'offer_expired' },
  });
  await saveJob(tx, moved);
  await tx.insert(jobEvents).values({ ...event, createdAt: now });
  await tx.insert(reliabilityEvents).values({
    id: newId('reliab'),
    providerId,
    jobId: job.id,
    type: 'offer_expired',
    createdAt: now,
  });
  return matchRound(tx, moved, now);
}

