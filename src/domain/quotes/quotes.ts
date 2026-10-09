import { Cents, kes } from '../money';
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

/**
 * Typical repair quotes per category. Simulated providers send these, and
 * real providers can start from them in the quote builder.
 */
const SAMPLE_ITEMS: Record<string, QuoteItemInput[]> = {
  brakes: [
    {
      kind: 'PART',
      description: 'Front brake pads',
      quantity: 1,
      unitPrice: kes(4500),
    },
    {
      kind: 'LABOUR',
      description: 'Replace pads and clean calipers',
      quantity: 1,
      unitPrice: kes(2000),
    },
  ],
  engine: [
    {
      kind: 'PART',
      description: 'Spark plugs',
      quantity: 4,
      unitPrice: kes(800),
    },
    {
      kind: 'LABOUR',
      description: 'Replace spark plugs and tune-up',
      quantity: 1,
      unitPrice: kes(2500),
    },
  ],
  electrical: [
    {
      kind: 'PART',
      description: 'Battery (70Ah)',
      quantity: 1,
      unitPrice: kes(12500),
    },
    {
      kind: 'LABOUR',
      description: 'Fit battery and clean terminals',
      quantity: 1,
      unitPrice: kes(1000),
    },
  ],
  suspension: [
    {
      kind: 'PART',
      description: 'Front shock absorbers',
      quantity: 2,
      unitPrice: kes(6500),
    },
    {
      kind: 'LABOUR',
      description: 'Replace front shocks',
      quantity: 1,
      unitPrice: kes(3500),
    },
  ],
};

const DEFAULT_ITEMS: QuoteItemInput[] = [
  {
    kind: 'PART',
    description: 'Replacement part',
    quantity: 1,
    unitPrice: kes(3000),
  },
  {
    kind: 'LABOUR',
    description: 'Repair labour',
    quantity: 2,
    unitPrice: kes(1500),
  },
];

export function sampleQuoteItems(categoryId: string): QuoteItemInput[] {
  return (SAMPLE_ITEMS[categoryId] ?? DEFAULT_ITEMS).map(item => ({ ...item }));
}
