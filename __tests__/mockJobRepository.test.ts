import { buildCreateJobInput } from '../src/customer/request/engine';
import { EMPTY_DRAFT, RequestDraft } from '../src/customer/request/types';
import {
  createMockJobRepository,
  MATCHING_DELAY_MS,
} from '../src/data/mock/MockJobRepository';
import { JobTransitionError } from '../src/domain/jobs/transitions';

const vehicle = {
  id: 'v1',
  make: 'Toyota',
  model: 'Fielder',
  registration: 'KDA 123A',
};

const draft: RequestDraft = {
  ...EMPTY_DRAFT,
  requestType: 'repair',
  vehicleId: 'v1',
  categoryId: 'brakes',
  answers: { 'brakes.symptoms': ['noise'] },
  description: '  Grinding when I stop  ',
  drivability: 'caution',
  location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
  urgency: 'now',
};

/**
 * Runs a mock call, fast-forwarding through its simulated network delay but
 * not far enough to trigger background work like matching.
 */
async function run<T>(call: Promise<T>): Promise<T> {
  await jest.advanceTimersByTimeAsync(500);
  return call;
}

describe('buildCreateJobInput', () => {
  it('turns a finished draft into job input', () => {
    const input = buildCreateJobInput(draft, vehicle);
    expect(input.description).toBe('Grinding when I stop');
    expect(input.vehicle).toEqual(vehicle);
    // A copy, so later edits to the vehicle don't change the job.
    expect(input.vehicle).not.toBe(vehicle);
  });

  it('refuses an incomplete draft', () => {
    expect(() =>
      buildCreateJobInput({ ...draft, location: undefined }, vehicle),
    ).toThrow();
    expect(() => buildCreateJobInput(draft, undefined)).toThrow();
  });
});

describe('MockJobRepository', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('creates a searching job for the current customer', async () => {
    const repo = createMockJobRepository();
    const job = await run(repo.createJob(buildCreateJobInput(draft, vehicle)));

    expect(job.status).toBe('SEARCHING');
    expect(job.customerId).toBe('customer-1');
    expect(job.vehicle.registration).toBe('KDA 123A');
    expect(job.createdAt).toBe(job.updatedAt);
  });

  it('takes time, like a network call', async () => {
    const repo = createMockJobRepository();
    let done = false;
    repo.createJob(buildCreateJobInput(draft, vehicle)).then(() => {
      done = true;
    });

    await jest.advanceTimersByTimeAsync(400);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });

  it('records the creation as the first event', async () => {
    const repo = createMockJobRepository();
    const job = await run(repo.createJob(buildCreateJobInput(draft, vehicle)));
    const events = await run(repo.getJobEvents(job.id));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      jobId: job.id,
      fromStatus: null,
      toStatus: 'SEARCHING',
      actor: 'CUSTOMER',
    });
  });

  it('tells subscribers when a job changes, until they unsubscribe', async () => {
    const repo = createMockJobRepository();
    const listener = jest.fn();
    const unsubscribe = repo.subscribe(listener);

    await run(repo.createJob(buildCreateJobInput(draft, vehicle)));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await run(repo.createJob(buildCreateJobInput(draft, vehicle)));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns the same snapshot object until the job changes', async () => {
    const repo = createMockJobRepository();
    const job = await run(repo.createJob(buildCreateJobInput(draft, vehicle)));

    expect(repo.getJobSnapshot(job.id)).toBe(repo.getJobSnapshot(job.id));
    expect(repo.getJobSnapshot('nope')).toBeUndefined();
  });

  it('keeps separate repositories separate', async () => {
    const a = createMockJobRepository();
    const b = createMockJobRepository();
    const job = await run(a.createJob(buildCreateJobInput(draft, vehicle)));

    expect(b.getJobSnapshot(job.id)).toBeUndefined();
  });
});

describe('MockJobRepository matching and cancelling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function createSearchingJob() {
    const repo = createMockJobRepository();
    const job = await run(repo.createJob(buildCreateJobInput(draft, vehicle)));
    return { repo, job };
  }

  it('offers the job to the nearest provider after a while', async () => {
    const { repo, job } = await createSearchingJob();
    expect(repo.getJobSnapshot(job.id)?.status).toBe('SEARCHING');

    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);

    const offered = repo.getJobSnapshot(job.id);
    expect(offered?.status).toBe('OFFERED');
    expect(offered?.offeredProviderId).toBe('p1');

    const events = await run(repo.getJobEvents(job.id));
    expect(events.at(-1)).toMatchObject({
      fromStatus: 'SEARCHING',
      toStatus: 'OFFERED',
      actor: 'SYSTEM',
      metadata: { providerId: 'p1' },
    });
  });

  it('lets the customer cancel while searching, and stops matching', async () => {
    const { repo, job } = await createSearchingJob();

    const cancelled = await run(repo.cancelJob(job.id));
    expect(cancelled.status).toBe('CANCELLED');

    // Matching's timer still fires, but must leave the cancelled job alone.
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.status).toBe('CANCELLED');
  });

  it('clears the offered provider when an offered job is cancelled', async () => {
    const { repo, job } = await createSearchingJob();
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);

    const cancelled = await run(repo.cancelJob(job.id));
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.offeredProviderId).toBeUndefined();
  });

  it('refuses to cancel a job twice', async () => {
    const { repo, job } = await createSearchingJob();
    await run(repo.cancelJob(job.id));

    await Promise.all([
      expect(repo.cancelJob(job.id)).rejects.toThrow(JobTransitionError),
      jest.advanceTimersByTimeAsync(500),
    ]);
  });

  it('returns the same job list until something changes', async () => {
    const { repo, job } = await createSearchingJob();
    const before = repo.getJobsSnapshot();
    expect(repo.getJobsSnapshot()).toBe(before);

    await run(repo.cancelJob(job.id));
    expect(repo.getJobsSnapshot()).not.toBe(before);
    expect(repo.getJobsSnapshot()[0].status).toBe('CANCELLED');
  });
});

describe('MockJobRepository offers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** A job that has been offered to the nearest provider, p1. */
  async function createOfferedJob() {
    const repo = createMockJobRepository();
    const job = await run(repo.createJob(buildCreateJobInput(draft, vehicle)));
    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    return { repo, job };
  }

  it('lets the offered provider accept, and makes them the job’s provider', async () => {
    const { repo, job } = await createOfferedJob();

    const accepted = await run(repo.acceptOffer(job.id, 'p1'));
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.providerId).toBe('p1');
    expect(accepted.offeredProviderId).toBeUndefined();
  });

  it('refuses an accept from a provider who was not offered the job', async () => {
    const { repo, job } = await createOfferedJob();

    await Promise.all([
      expect(repo.acceptOffer(job.id, 'p2')).rejects.toThrow(
        'not offered to p2',
      ),
      jest.advanceTimersByTimeAsync(500),
    ]);
    expect(repo.getJobSnapshot(job.id)?.status).toBe('OFFERED');
  });

  it('offers a declined job to the next nearest provider', async () => {
    const { repo, job } = await createOfferedJob();

    const declined = await run(repo.declineOffer(job.id, 'p1'));
    expect(declined.status).toBe('SEARCHING');

    await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    expect(repo.getJobSnapshot(job.id)?.offeredProviderId).toBe('p2');
  });

  it('cancels the job when every provider has declined', async () => {
    const { repo, job } = await createOfferedJob();

    for (const providerId of ['p1', 'p2', 'p3']) {
      await run(repo.declineOffer(job.id, providerId));
      await jest.advanceTimersByTimeAsync(MATCHING_DELAY_MS);
    }

    expect(repo.getJobSnapshot(job.id)?.status).toBe('CANCELLED');
    const events = await run(repo.getJobEvents(job.id));
    expect(events.at(-1)).toMatchObject({
      actor: 'SYSTEM',
      metadata: { reason: 'no_provider_available' },
    });
  });
});
