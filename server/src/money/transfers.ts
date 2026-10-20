import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { refunds, transfers } from '../db/schema';
import { reportIncident } from '../incidents';
import { MpesaError, type MpesaGateway, toShillings } from '../mpesa/gateway';
import { account, post } from './ledger';

/** After this many tries a transfer stops and waits for a person. */
export const MAX_TRANSFER_ATTEMPTS = 5;
/** Waits between tries: 1 min, 5 min, 15 min, 1 h. */
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];
/** Handed to M-Pesa this long ago with no answer: we can't know if it went. */
const STUCK_AFTER_MS = 5 * 60_000;

type TransferRow = typeof transfers.$inferSelect;

const incident = (db: Database, title: string, t: TransferRow, detail: Record<string, unknown> = {}) =>
  reportIncident(db, {
    kind: 'mpesa',
    title,
    where: `transfer ${t.kind.toLowerCase()}`,
    detail: { transferId: t.id, amount: t.amount, phone: t.phone, ...detail },
    jobId: t.jobId,
  });

/**
 * Sends queued transfers through M-Pesa B2C. Each is claimed first
 * (QUEUED → SENDING, skipping any another worker holds), then sent with
 * no database lock held. M-Pesa's answer to the request only says it was
 * accepted; whether the money arrived comes later, by callback.
 */
export async function runTransfers(db: Database, mpesa: MpesaGateway, now = new Date(), limit = 20) {
  await failStuck(db, now);
  const claimed = await db.transaction(async tx => {
    const due = await tx
      .select({ id: transfers.id })
      .from(transfers)
      .where(and(eq(transfers.status, 'QUEUED'), lte(transfers.nextAttemptAt, now)))
      .orderBy(transfers.nextAttemptAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) {
      return [];
    }
    return tx
      .update(transfers)
      .set({ status: 'SENDING', attempts: sql`${transfers.attempts} + 1`, updatedAt: now })
      .where(inArray(transfers.id, due.map(d => d.id)))
      .returning();
  });

  for (const t of claimed) {
    try {
      const { conversationId } = await mpesa.b2c({
        transferId: t.id,
        phone: t.phone,
        shillings: toShillings(t.amount),
        remarks: t.kind === 'PAYOUT' ? 'Fundi-X payout' : 'Fundi-X refund',
      });
      await db
        .update(transfers)
        .set({ status: 'SENT', conversationId, lastError: null, updatedAt: new Date() })
        .where(and(eq(transfers.id, t.id), eq(transfers.status, 'SENDING')));
    } catch (err) {
      const message = (err as Error).message;
      const retry = err instanceof MpesaError && err.retryable && t.attempts < MAX_TRANSFER_ATTEMPTS;
      await db
        .update(transfers)
        .set(
          retry
            ? {
                status: 'QUEUED',
                lastError: message,
                nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[Math.min(t.attempts - 1, BACKOFF_MS.length - 1)]),
                updatedAt: new Date(),
              }
            : { status: 'FAILED', lastError: message, updatedAt: new Date() },
        )
        .where(eq(transfers.id, t.id));
      if (!retry) {
        await incident(db, 'M-Pesa transfer could not be sent', t, { error: message });
      }
    }
  }
  return claimed.length;
}

/**
 * A transfer handed to M-Pesa with no answer (the server stopped mid-send)
 * might or might not have gone. Sending again could pay twice, so a
 * person checks M-Pesa first, then retries or marks it done.
 */
async function failStuck(db: Database, now: Date) {
  const stuck = await db
    .update(transfers)
    .set({
      status: 'FAILED',
      lastError: 'Interrupted while sending: check the M-Pesa statement before retrying',
      updatedAt: now,
    })
    .where(and(eq(transfers.status, 'SENDING'), lt(transfers.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS))))
    .returning();
  for (const t of stuck) {
    await incident(db, 'M-Pesa transfer interrupted while sending', t);
  }
}

/** Finds a transfer by our id or M-Pesa's (callbacks carry both). */
const matching = (ids: { transferId?: string; conversationId?: string }) =>
  ids.transferId ? eq(transfers.id, ids.transferId) : eq(transfers.conversationId, ids.conversationId ?? '');

/**
 * M-Pesa says the money arrived. Records it once, however often it's
 * reported: the ledger moves it out of what's owed, and a refund is
 * marked sent.
 */
export async function transferSucceeded(
  db: Database,
  ids: { transferId?: string; conversationId?: string },
  receipt: string,
  at = new Date(),
) {
  return db.transaction(async tx => {
    const [t] = await tx.select().from(transfers).where(matching(ids)).for('update');
    if (!t || t.status === 'SUCCESS') {
      return t ?? null;
    }
    await tx
      .update(transfers)
      .set({ status: 'SUCCESS', receiptNumber: receipt, lastError: null, completedAt: at, updatedAt: at })
      .where(eq(transfers.id, t.id));
    const owedTo = t.kind === 'PAYOUT' ? account.provider(t.recipientId) : account.customer(t.recipientId);
    await post(
      tx,
      t.kind === 'PAYOUT' ? 'PAYOUT_SENT' : 'REFUND_SENT',
      `M-Pesa ${receipt} to ${t.phone}`,
      { jobId: t.jobId, transferId: t.id, ...(t.releaseId && { releaseId: t.releaseId }), ...(t.refundId && { refundId: t.refundId }) },
      [
        { account: owedTo, amount: t.amount },
        { account: account.mpesa, amount: -t.amount },
      ],
      at,
    );
    if (t.refundId) {
      await tx.update(refunds).set({ status: 'SUCCESS', updatedAt: at }).where(eq(refunds.id, t.refundId));
    }
    return t;
  });
}

/** M-Pesa says the transfer didn't go. The money stays owed; a person decides. */
export async function transferFailed(
  db: Database,
  ids: { transferId?: string; conversationId?: string },
  reason: string,
  at = new Date(),
) {
  const [t] = await db
    .update(transfers)
    .set({ status: 'FAILED', lastError: reason, updatedAt: at })
    .where(and(matching(ids), inArray(transfers.status, ['SENDING', 'SENT'])))
    .returning();
  if (t) {
    await incident(db, 'M-Pesa transfer failed', t, { reason });
  }
  return t ?? null;
}

/** Sends a failed transfer again (an admin action, with a reason). */
export async function retryTransfer(db: Database, transferId: string, at = new Date()) {
  const [t] = await db
    .update(transfers)
    .set({ status: 'QUEUED', attempts: 0, nextAttemptAt: at, lastError: null, conversationId: null, updatedAt: at })
    .where(and(eq(transfers.id, transferId), eq(transfers.status, 'FAILED')))
    .returning();
  return t ?? null;
}

/**
 * A person checked M-Pesa and the money did arrive (e.g. after an
 * interrupted send): record it with the receipt they found.
 */
export async function markTransferSent(db: Database, transferId: string, receipt: string, at = new Date()) {
  const [t] = await db.select().from(transfers).where(eq(transfers.id, transferId));
  if (!t || t.status !== 'FAILED') {
    return null;
  }
  return transferSucceeded(db, { transferId }, receipt, at);
}

/** Runs runTransfers every few seconds. Returns a stop function. */
export function startTransferWorker(
  db: Database,
  mpesa: MpesaGateway,
  { onError, everyMs = 5_000 }: { onError: (err: unknown) => void; everyMs?: number },
) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runTransfers(db, mpesa);
    } catch (err) {
      onError(err);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}
