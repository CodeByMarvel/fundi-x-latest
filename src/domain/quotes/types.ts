import type { Cents } from '../money';

/**
 * What a quote line is for. There's no call-out or inspection line: the
 * call-out fee (which covers both) is set by Fundi-X at booking, never quoted
 * by a provider.
 */
export type QuoteItemKind = 'PART' | 'LABOUR' | 'CONSUMABLE' | 'OTHER';

export type QuoteItem = {
  id: string;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unitPrice: Cents;
  /** quantity × unitPrice, stored so every screen shows the same number. */
  total: Cents;
};

/** What gets filled in; ids and totals are worked out from it. */
export type QuoteItemInput = Pick<
  QuoteItem,
  'kind' | 'description' | 'quantity' | 'unitPrice'
>;

/**
 * BASE: the main price for the job, from Fundi-X (fixed-price work) or the
 * provider (after diagnosis). ADDITIONAL: extra work the provider found on
 * site, added on top of the base without changing it.
 */
export type QuoteKind = 'BASE' | 'ADDITIONAL';

export type QuoteIssuer = 'FUNDI_X' | 'PROVIDER';

/**
 * PENDING: waiting for the customer. SUPERSEDED: the provider withdrew it to
 * send a new version, so it can no longer be approved.
 */
export type QuoteStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export type Quote = {
  id: string;
  jobId: string;
  kind: QuoteKind;
  issuedBy: QuoteIssuer;
  /** Set for provider quotes. */
  providerId?: string;
  /** 1 for the first BASE quote on a job, 2 after one revision, and so on. */
  version: number;
  status: QuoteStatus;
  items: QuoteItem[];
  total: Cents;
  /** Note to the customer. */
  note?: string;
  /** ADDITIONAL: why the extra work is needed. */
  reason?: string;
  createdAt: string;
  /** When the customer approved or rejected it. */
  respondedAt?: string;
};
