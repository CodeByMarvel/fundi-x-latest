import type { Cents } from '../money';

export type QuoteItemKind =
  | 'CALL_OUT'
  | 'INSPECTION'
  | 'LABOUR'
  | 'PART'
  | 'OTHER';

export type QuoteItem = {
  id: string;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unitPrice: Cents;
  /** quantity × unitPrice, stored so every screen shows the same number. */
  total: Cents;
};

/** What a provider fills in; ids and totals are worked out for them. */
export type QuoteItemInput = Pick<
  QuoteItem,
  'kind' | 'description' | 'quantity' | 'unitPrice'
>;

/**
 * PENDING: waiting for the customer. SUPERSEDED: the provider withdrew it to
 * send a new version, so it can no longer be approved.
 */
export type QuoteStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export type Quote = {
  id: string;
  jobId: string;
  providerId: string;
  /** 1 for the first quote on a job, 2 after one revision, and so on. */
  version: number;
  status: QuoteStatus;
  items: QuoteItem[];
  total: Cents;
  note?: string;
  createdAt: string;
  respondedAt?: string;
};
