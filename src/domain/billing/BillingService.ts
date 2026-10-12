import { Charge, Payment, Refund, Release } from './types';

/**
 * Money for jobs: what's owed, what's been paid into escrow, and what left
 * escrow as refunds or provider payouts. The mock simulates M-Pesa; the real
 * one will call our backend, which talks to Safaricom's Daraja API.
 *
 * The app only ever *starts* a payment. Charges, refunds and releases are
 * created by the backend as the job moves on.
 */
export interface BillingService {
  /**
   * Sends an STK prompt for whatever the job is waiting for: the call-out
   * (CALL_OUT_PAYMENT_PENDING) or the agreed service price
   * (SERVICE_PAYMENT_PENDING). Pass `quoteId` to approve-and-pay an
   * additional quote while IN_PROGRESS. The backend decides the amount; the
   * money goes into escrow either way. Resolves once the prompt is on its way
   * (status PENDING); watch the payment snapshot for what happens next.
   * Rejects with PaymentError if the phone number is invalid, the job isn't
   * awaiting payment, or a payment is already running.
   */
  initiatePayment(
    jobId: string,
    phone: string,
    options?: { quoteId?: string },
  ): Promise<Payment>;

  getPaymentSnapshot(paymentId: string): Payment | undefined;
  // Every record, oldest first. Same array until something changes.
  getChargesSnapshot(): readonly Charge[];
  getPaymentsSnapshot(): readonly Payment[];
  getRefundsSnapshot(): readonly Refund[];
  getReleasesSnapshot(): readonly Release[];
  subscribe(listener: () => void): () => void;
}
