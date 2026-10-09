import type { Cents } from '../money';

/**
 * PENDING: the STK prompt is on the customer's phone, waiting for their PIN.
 * PROCESSING: they responded and M-Pesa is working on it.
 */
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export type PaymentFailureReason =
  | 'cancelled_by_user'
  | 'insufficient_funds'
  | 'timeout';

export type Payment = {
  id: string;
  jobId: string;
  method: 'MPESA';
  /** Normalised to 2547XXXXXXXX / 2541XXXXXXXX. */
  phone: string;
  amount: Cents;
  status: PaymentStatus;
  failureReason?: PaymentFailureReason;
  /** M-Pesa's transaction code, e.g. "SJK4H7Q2LX". */
  receiptNumber?: string;
  createdAt: string;
  updatedAt: string;
};

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

/**
 * Turns the ways Kenyans write phone numbers (0712…, +254712…, 254712…)
 * into the 2547XXXXXXXX form M-Pesa expects. Returns undefined if it isn't
 * a valid Safaricom-style mobile number.
 */
export function normaliseMpesaPhone(input: string): string | undefined {
  const digits = input.replace(/[\s-]/g, '').replace(/^\+/, '');
  const match = digits.match(/^(?:254|0)?([17]\d{8})$/);
  return match ? `254${match[1]}` : undefined;
}

/** 254712345678 → "0712 345 678" */
export function formatPhone(normalised: string) {
  const local = `0${normalised.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
