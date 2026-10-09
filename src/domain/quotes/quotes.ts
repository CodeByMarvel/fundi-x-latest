import { Cents, kes } from '../money';
import { QuoteItem, QuoteItemInput, QuoteItemKind } from './types';

export const QUOTE_ITEM_KINDS: { kind: QuoteItemKind; label: string }[] = [
  { kind: 'CALL_OUT', label: 'Call-out' },
  { kind: 'INSPECTION', label: 'Inspection' },
  { kind: 'LABOUR', label: 'Labour' },
  { kind: 'PART', label: 'Part' },
  { kind: 'OTHER', label: 'Other' },
];

export function quoteItemKindLabel(kind: QuoteItemKind) {
  return QUOTE_ITEM_KINDS.find(k => k.kind === kind)!.label;
}

/** Kinds the customer still owes for if they turn the quote down. */
const FEE_KINDS: QuoteItemKind[] = ['CALL_OUT', 'INSPECTION'];

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

/** The call-out and inspection part of a quote: owed even if rejected. */
export function feeTotal(items: QuoteItem[]): Cents {
  return sumItems(items.filter(item => FEE_KINDS.includes(item.kind)));
}

const CALL_OUT: QuoteItemInput = {
  kind: 'CALL_OUT',
  description: 'Call-out fee',
  quantity: 1,
  unitPrice: kes(1000),
};

/**
 * Typical quotes per category. Simulated providers send these, and real
 * providers can start from them in the quote builder.
 */
const SAMPLE_ITEMS: Record<string, QuoteItemInput[]> = {
  brakes: [
    CALL_OUT,
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
  brake_service: [
    CALL_OUT,
    {
      kind: 'PART',
      description: 'Brake fluid (DOT 4, 1L)',
      quantity: 1,
      unitPrice: kes(1200),
    },
    {
      kind: 'LABOUR',
      description: 'Brake service and fluid flush',
      quantity: 1,
      unitPrice: kes(2500),
    },
  ],
  engine: [
    CALL_OUT,
    {
      kind: 'INSPECTION',
      description: 'Engine diagnostic scan',
      quantity: 1,
      unitPrice: kes(1500),
    },
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
    CALL_OUT,
    {
      kind: 'INSPECTION',
      description: 'Battery and charging test',
      quantity: 1,
      unitPrice: kes(800),
    },
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
  oil_service: [
    CALL_OUT,
    {
      kind: 'PART',
      description: 'Engine oil 5W-30 (4L)',
      quantity: 1,
      unitPrice: kes(3800),
    },
    {
      kind: 'PART',
      description: 'Oil filter',
      quantity: 1,
      unitPrice: kes(900),
    },
    {
      kind: 'LABOUR',
      description: 'Oil and filter change',
      quantity: 1,
      unitPrice: kes(1000),
    },
  ],
};

const DEFAULT_ITEMS: QuoteItemInput[] = [
  CALL_OUT,
  {
    kind: 'INSPECTION',
    description: 'Inspection',
    quantity: 1,
    unitPrice: kes(1000),
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
