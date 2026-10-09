import type { Cents } from '../money';

/**
 * What money is for. CALL_OUT: transport and inspection, paid before
 * dispatch. SERVICE: the work itself (approved quotes), paid at the end.
 */
export type MoneyPurpose = 'CALL_OUT' | 'SERVICE';

/** Something the customer owes. Created by the backend, never edited. */
export type Charge = {
  id: string;
  jobId: string;
  purpose: MoneyPurpose;
  amount: Cents;
  description: string;
  /** The approved quote this charge comes from (SERVICE charges). */
  quoteId?: string;
  createdAt: string;
};

/**
 * PENDING: the STK prompt is on the customer's phone, waiting for their PIN.
 * PROCESSING: they responded and M-Pesa is working on it.
 */
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export type PaymentFailureReason =
  | 'cancelled_by_user'
  | 'insufficient_funds'
  | 'timeout';

/** Money sent by the customer into Fundi-X escrow. */
export type Payment = {
  id: string;
  jobId: string;
  purpose: MoneyPurpose;
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

/** Money returned from escrow to the customer. */
export type Refund = {
  id: string;
  jobId: string;
  paymentId: string;
  amount: Cents;
  reason: string;
  /** PENDING while M-Pesa sends it back. */
  status: 'PENDING' | 'SUCCESS';
  createdAt: string;
  updatedAt: string;
};

/** One payment's share of a release. */
export type ReleaseLine = {
  paymentId: string;
  purpose: MoneyPurpose;
  gross: Cents;
  commission: Cents;
};

/** Money paid out of escrow to the provider when a job ends. */
export type Release = {
  id: string;
  jobId: string;
  providerId: string;
  lines: ReleaseLine[];
  gross: Cents;
  commission: Cents;
  /** What the provider receives: gross − commission. */
  net: Cents;
  createdAt: string;
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
