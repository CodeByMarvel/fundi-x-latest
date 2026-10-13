import type { Tx } from '../db/client';
import { type TimerKind, timers } from '../db/schema';
import { newId } from '../ids';

/**
 * Schedules a timer inside the caller's transaction, so it's saved together
 * with the change that needs it (or not at all).
 */
export async function scheduleTimer(
  tx: Tx,
  t: { jobId: string; kind: TimerKind; dueAt: Date; at: Date },
) {
  await tx.insert(timers).values({
    id: newId('tmr'),
    jobId: t.jobId,
    kind: t.kind,
    dueAt: t.dueAt,
    status: 'PENDING',
    createdAt: t.at,
    updatedAt: t.at,
  });
}
