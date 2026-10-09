import { Payment } from './types';

/**
 * Taking money for a job. The mock simulates an M-Pesa STK push; the real
 * one will call our backend, which talks to Safaricom's Daraja API.
 *
 * The app never marks a job paid itself. When a payment succeeds, the
 * backend moves the job to PAID and the job repository announces it.
 */
export interface PaymentService {
  /**
   * Sends the STK prompt to `phone` for the job's amount due. Resolves once
   * the prompt is on its way (status PENDING); watch the payment snapshot
   * for what happens next. Rejects with PaymentError if the phone number is
   * invalid, the job isn't awaiting payment, or a payment is already running.
   */
  initiatePayment(jobId: string, phone: string): Promise<Payment>;

  getPaymentSnapshot(paymentId: string): Payment | undefined;
  /** Every payment, oldest first. Same array until something changes. */
  getPaymentsSnapshot(): readonly Payment[];
  subscribe(listener: () => void): () => void;
}
