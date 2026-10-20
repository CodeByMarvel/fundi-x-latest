import { JobRequestDetails, PricingMode } from '../jobs/types';
import { Cents } from '../money';
import type { FixedServicePrice, PartsOption } from './catalog';

/** What a booking will cost, shown to the customer before they pay. */
export type PriceEstimate = {
  pricingMode: PricingMode;
  /** Transport and inspection, paid before dispatch. */
  callOut: Cents;
  /**
   * FIXED pricing only: the Fundi-X price for the work. Labour is always
   * included; the parts are added unless the customer brings their own.
   */
  fixedService?: FixedServicePrice & {
    partsOption: PartsOption;
    /** What the work costs with this parts option. */
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
  /** The fixed-price services on offer now (the catalog's active packages). */
  services(): Promise<{ id: string; name: string }[]>;
}

/** The price changed between the customer seeing it and booking. */
export class PriceChangedError extends Error {
  constructor() {
    super('The price has changed since you last saw it');
    this.name = 'PriceChangedError';
    Object.setPrototypeOf(this, PriceChangedError.prototype);
  }
}
