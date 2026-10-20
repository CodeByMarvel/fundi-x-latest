import { and, inArray, isNotNull, lt, not, like } from 'drizzle-orm';
import type { Database } from '../db/client';
import { payments } from '../db/schema';
import { applyStkOutcome } from '../payments/service';
import { MpesaError, type MpesaGateway } from './gateway';
import { SIMULATED } from './simulator';

/** Give the callback this long before asking M-Pesa ourselves. */
const ASK_AFTER_MS = 75_000;
/** A prompt still "being processed" after this has been abandoned. */
const GIVE_UP_AFTER_MS = 5 * 60_000;

/**
 * Callbacks can be lost (our server restarting, a network blip). Prompts
 * that are still open after their callback should have arrived are asked
 * about directly (STK query), so a customer who paid is never left
 * waiting, and one who didn't can try again. Returns how many were settled.
 */
export async function reconcilePrompts(db: Database, mpesa: MpesaGateway, now = new Date()) {
  const open = await db
    .select({ id: payments.id, checkoutRequestId: payments.checkoutRequestId, createdAt: payments.createdAt })
    .from(payments)
    .where(
      and(
        inArray(payments.status, ['PENDING', 'PROCESSING']),
        isNotNull(payments.checkoutRequestId),
        not(like(payments.checkoutRequestId, `${SIMULATED}%`)),
        lt(payments.createdAt, new Date(now.getTime() - ASK_AFTER_MS)),
      ),
    )
    .limit(50);

  let settled = 0;
  for (const p of open) {
    try {
      let outcome = await mpesa.stkQuery(p.checkoutRequestId!);
      if (outcome.state === 'PENDING' && now.getTime() - p.createdAt.getTime() > GIVE_UP_AFTER_MS) {
        outcome = { state: 'FAILED', reason: 'timeout', detail: 'no answer after 5 minutes' };
      }
      if (outcome.state !== 'PENDING') {
        await applyStkOutcome(db, p.id, outcome, now);
        settled++;
      }
    } catch (err) {
      if (!(err instanceof MpesaError)) {
        throw err;
      }
      // M-Pesa busy or unreachable: ask again next round.
    }
  }
  return settled;
}

/** Runs reconcilePrompts every 30 seconds. Returns a stop function. */
export function startPromptReconciler(
  db: Database,
  mpesa: MpesaGateway,
  { onError }: { onError: (err: unknown) => void },
) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await reconcilePrompts(db, mpesa);
    } catch (err) {
      onError(err);
    } finally {
      running = false;
    }
  }, 30_000);
  return () => clearInterval(timer);
}
