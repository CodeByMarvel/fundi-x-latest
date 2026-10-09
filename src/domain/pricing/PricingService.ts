import { JobRequestDetails, PricingMode } from '../jobs/types';
import { Cents } from '../money';
import { QuoteItemInput } from '../quotes/types';

/** What a booking will cost, shown to the customer before they pay. */
export type PriceEstimate = {
  pricingMode: PricingMode;
  /** Transport and inspection, paid before dispatch. */
  callOut: Cents;
  callOutBreakdown: { base: Cents; distance: Cents };
  /** FIXED pricing only: the Fundi-X price for the work. */
  fixedService?: {
    packageName: string;
    items: QuoteItemInput[];
    total: Cents;
  };
};

/**
 * Where prices come from. During the first years, maintenance comes from a
 * Fundi-X catalog while real prices are gathered; later a pricing model can
 * replace it behind this same interface, without touching the job flow.
 */
export interface PricingService {
  estimate(details: JobRequestDetails): Promise<PriceEstimate>;
}

/** The price changed between the customer seeing it and booking. */
export class PriceChangedError extends Error {
  constructor() {
    super('The price has changed since you last saw it');
    this.name = 'PriceChangedError';
    Object.setPrototypeOf(this, PriceChangedError.prototype);
  }
}
