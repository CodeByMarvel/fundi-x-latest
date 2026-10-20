import type { PaymentFailureReason } from '../../../src/domain/billing/types';

/**
 * What the server needs from M-Pesa (docs/mpesa.md). Two implementations:
 * Daraja (the real API, sandbox or production) and the simulator used in
 * development and tests. The rest of the server never knows which.
 *
 * Amounts here are whole shillings: M-Pesa has no cents.
 */
export interface MpesaGateway {
  readonly name: 'daraja' | 'simulator';

  /** Shows the PIN prompt on the customer's phone (M-Pesa Express). */
  stkPush(request: {
    phone: string;
    shillings: number;
    /** Shown on the customer's M-Pesa statement; up to 12 characters. */
    accountReference: string;
    description: string;
  }): Promise<{ checkoutRequestId: string; merchantRequestId: string }>;

  /** Asks how a prompt ended, for when its callback never arrived. */
  stkQuery(checkoutRequestId: string): Promise<StkOutcome>;

  /** Sends money to a phone (B2C): mechanic payouts and customer refunds. */
  b2c(request: {
    /** Our transfer id, sent as OriginatorConversationID: one transfer, one send. */
    transferId: string;
    phone: string;
    shillings: number;
    remarks: string;
  }): Promise<{ conversationId: string }>;
}

export type StkOutcome =
  | { state: 'SUCCESS'; receipt: string | null }
  | { state: 'FAILED'; reason: PaymentFailureReason; detail: string }
  | { state: 'PENDING' };

/** Thrown when M-Pesa refuses or can't be reached; the message is safe to log. */
export class MpesaError extends Error {
  constructor(
    message: string,
    /** Worth trying again later (network trouble, M-Pesa busy). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MpesaError';
  }
}

/**
 * M-Pesa Express result codes (from the callback and the status query)
 * as our failure reasons. 0 is success; anything unknown is "declined".
 */
export function stkFailureReason(resultCode: number): PaymentFailureReason {
  switch (resultCode) {
    case 1032:
      return 'cancelled_by_user';
    case 1:
      return 'insufficient_funds';
    case 2001:
      return 'wrong_pin';
    case 1037: // phone unreachable / no response
    case 1019: // transaction expired
      return 'timeout';
    default:
      return 'declined';
  }
}

/** Cents to whole shillings; refuses amounts M-Pesa can't send. */
export function toShillings(cents: number) {
  if (!Number.isInteger(cents) || cents <= 0 || cents % 100 !== 0) {
    throw new MpesaError(`M-Pesa amounts must be whole shillings above zero (got ${cents} cents)`, false);
  }
  return cents / 100;
}

/** 254712345678 → the form Daraja wants (the same, as a number string). */
export const darajaPhone = (phone: string) => phone.replace(/^\+/, '');
