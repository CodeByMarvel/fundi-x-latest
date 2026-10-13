import { and, asc, eq, lte } from 'drizzle-orm';
import type { Database } from '../db/client';
import { timers } from '../db/schema';
import { TIMER_HANDLERS } from './handlers';

/** After this many errors a timer stops retrying and waits for a person. */
export const MAX_TIMER_ATTEMPTS = 5;
const RETRY_STEP_MS = 60_000;

export type TimerRun = { fired: number; retried: number; failed: number };

/**
 * Fires every timer that is due at `now`. Each one runs in its own
 * transaction, so one broken timer can't hold up the rest.
 *
 * `now` is a parameter so tests can jump to "31 minutes later" without
 * waiting or faking the clock.
 */
export async function runDueTimers(
  db: Database,
  now = new Date(),
  limit = 100,
): Promise<TimerRun> {
  const due = await db
    .select({ id: timers.id })
    .from(timers)
    .where(and(eq(timers.status, 'PENDING'), lte(timers.dueAt, now)))
    .orderBy(asc(timers.dueAt))
    .limit(limit);

  const run: TimerRun = { fired: 0, retried: 0, failed: 0 };
  for (const { id } of due) {
    try {
      const result = await fireTimer(db, id, now);
      if (result) {
        run[result]++;
      }
    } catch (err) {
      await recordFailure(db, id, now, err);
      run.failed++;
    }
  }
  return run;
}

async function fireTimer(db: Database, id: string, now: Date) {
  return db.transaction(async tx => {
    // Locked, and skipped if another worker already holds it: with several
    // servers running, each timer still fires exactly once.
    const [timer] = await tx
      .select()
      .from(timers)
      .where(and(eq(timers.id, id), eq(timers.status, 'PENDING')))
      .for('update', { skipLocked: true });
    if (!timer) {
      return null; // another worker got there first
    }
    const handler = TIMER_HANDLERS[timer.kind];
    if (!handler) {
      throw new Error(`No handler for timer kind ${timer.kind}`);
    }

    const outcome = await handler(tx, timer.jobId, now);
    await tx
      .update(timers)
      .set(
        outcome.done
          ? { status: 'DONE', updatedAt: now }
          : { dueAt: outcome.retryAt, updatedAt: now },
      )
      .where(eq(timers.id, id));
    return outcome.done ? ('fired' as const) : ('retried' as const);
  });
}

/**
 * The handler's transaction was rolled back, so the job is untouched. Note
 * the error and try again later, waiting a little longer each time.
 */
async function recordFailure(
  db: Database,
  id: string,
  now: Date,
  err: unknown,
) {
  const [timer] = await db.select().from(timers).where(eq(timers.id, id));
  if (!timer) {
    return;
  }
  const attempts = timer.attempts + 1;
  await db
    .update(timers)
    .set({
      attempts,
      lastError: err instanceof Error ? err.message : String(err),
      ...(attempts >= MAX_TIMER_ATTEMPTS
        ? { status: 'FAILED' as const }
        : { dueAt: new Date(now.getTime() + attempts * RETRY_STEP_MS) }),
      updatedAt: now,
    })
    .where(eq(timers.id, id));
}

/**
 * Checks for due timers every few seconds. The first check runs at once,
 * which is how deadlines missed while the server was down get handled.
 * Returns `stop`, which waits for a check in progress to finish.
 */
export function startTimerWorker(
  db: Database,
  {
    everyMs = 5000,
    onRun,
    onError,
  }: {
    everyMs?: number;
    onRun?: (run: TimerRun) => void;
    onError?: (err: unknown) => void;
  } = {},
) {
  let current: Promise<void> | undefined;
  const tick = () => {
    if (current) {
      return; // the previous check is still going; don't pile up
    }
    current = runDueTimers(db)
      .then(run => {
        if (run.fired + run.retried + run.failed > 0) {
          onRun?.(run);
        }
      })
      .catch(err => onError?.(err))
      .finally(() => {
        current = undefined;
      });
  };
  tick();
  const interval = setInterval(tick, everyMs);
  return async () => {
    clearInterval(interval);
    await current;
  };
}
