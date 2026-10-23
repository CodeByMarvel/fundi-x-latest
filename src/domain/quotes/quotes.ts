import { Cents, kes } from '../money';
import { isKnownCode, serviceCode } from './serviceCodes';
import { Quote, QuoteItem, QuoteItemInput, QuoteItemKind } from './types';

export const QUOTE_ITEM_KINDS: { kind: QuoteItemKind; label: string }[] = [
  { kind: 'PART', label: 'Part' },
  { kind: 'LABOUR', label: 'Labour' },
  { kind: 'CONSUMABLE', label: 'Consumable' },
  { kind: 'OTHER', label: 'Other' },
];

export function quoteItemKindLabel(kind: QuoteItemKind) {
  return QUOTE_ITEM_KINDS.find(k => k.kind === kind)!.label;
}

export class QuoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteValidationError';
    Object.setPrototypeOf(this, QuoteValidationError.prototype);
  }
}

/**
 * The customer acted on a quote that's been withdrawn, revised or already
 * answered, typically because their screen was a moment out of date.
 */
export class StaleQuoteError extends Error {
  constructor() {
    super('This quote is no longer current');
    this.name = 'StaleQuoteError';
    Object.setPrototypeOf(this, StaleQuoteError.prototype);
  }
}

/** The provider tried to finish while the customer is still deciding on extra work. */
export class AdditionalQuotePendingError extends Error {
  constructor() {
    super('The customer has not answered the additional quote yet');
    this.name = 'AdditionalQuotePendingError';
    Object.setPrototypeOf(this, AdditionalQuotePendingError.prototype);
  }
}

/** Throws QuoteValidationError with a message fit to show the provider. */
export function validateQuoteItems(items: QuoteItemInput[]) {
  if (items.length === 0) {
    throw new QuoteValidationError('Add at least one item to the quote.');
  }
  for (const item of items) {
    if (!isKnownCode(item.serviceCode)) {
      throw new QuoteValidationError(
        `Pick what "${item.description}" is from the list, or choose Other.`,
      );
    }
    if (!item.description.trim()) {
      throw new QuoteValidationError('Every item needs a description.');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new QuoteValidationError(
        `"${item.description}" needs a quantity of at least 1.`,
      );
    }
    if (!Number.isInteger(item.unitPrice) || item.unitPrice <= 0) {
      throw new QuoteValidationError(
        `"${item.description}" needs a price above zero.`,
      );
    }
  }
}

export function buildQuoteItems(
  inputs: QuoteItemInput[],
  makeId: () => string,
): QuoteItem[] {
  return inputs.map(input => ({
    ...input,
    id: makeId(),
    description: input.description.trim(),
    total: input.quantity * input.unitPrice,
  }));
}

export function sumItems(items: Pick<QuoteItem, 'total'>[]): Cents {
  return items.reduce((sum, item) => sum + item.total, 0);
}

/**
 * The parts in a quote. Charged and paid like a fixed-price job's parts: the
 * money goes to the mechanic as soon as it's paid, so they can buy them,
 * with the smaller parts commission.
 */
export function partsTotal(items: Pick<QuoteItem, 'kind' | 'total'>[]): Cents {
  return sumItems(items.filter(item => item.kind === 'PART'));
}

/** Additional quotes on a job, oldest first. */
export function additionalQuotes(quotes: readonly Quote[], jobId: string) {
  return quotes.filter(q => q.jobId === jobId && q.kind === 'ADDITIONAL');
}

export function hasPendingAdditionalQuote(
  quotes: readonly Quote[],
  jobId: string,
) {
  return additionalQuotes(quotes, jobId).some(q => q.status === 'PENDING');
}

/** A quote line from a service code, using the code's label as description. */
export function line(
  code: string,
  shillings: number,
  quantity = 1,
): QuoteItemInput {
  const known = serviceCode(code)!;
  return {
    serviceCode: code,
    kind: known.kind,
    description: known.label,
    quantity,
    unitPrice: kes(shillings),
  };
}

/**
 * Typical repair quotes per category. Simulated providers send these, and
 * real providers can start from them in the quote builder.
 */
const SAMPLE_ITEMS: Record<string, QuoteItemInput[]> = {
  brakes: [line('BRAKE_PAD_FRONT', 4500), line('LABOUR_BRAKE_PADS', 2000)],
  engine: [line('SPARK_PLUG', 800, 4), line('LABOUR_SPARK_PLUGS', 2500)],
  electrical: [line('BATTERY', 12500), line('LABOUR_BATTERY', 1000)],
  suspension: [
    line('SHOCK_ABSORBER_FRONT', 6500, 2),
    line('LABOUR_SHOCKS', 3500),
  ],
};

const DEFAULT_ITEMS: QuoteItemInput[] = [
  line('LABOUR_DIAGNOSTICS', 1500),
  line('LABOUR_GENERAL', 1500, 2),
];

export function sampleQuoteItems(categoryId: string): QuoteItemInput[] {
  return (SAMPLE_ITEMS[categoryId] ?? DEFAULT_ITEMS).map(item => ({ ...item }));
}
