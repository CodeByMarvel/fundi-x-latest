import { JobRequestDetails } from '../jobs/types';
import { Cents, kes } from '../money';
import { Catalog, DEFAULT_CATALOG, fixedTotal, priceFixedService } from './catalog';
import { PriceEstimate } from './PricingService';

/**
 * The default call-out fee. Flat on purpose: H3 ring-limited matching caps
 * how far a provider can be sent, so one fee is fair (docs/job-flow.md
 * §3.1). The server passes the live value from its `settings` table, so
 * changing it is a data change, not a code change.
 */
export const CALL_OUT_FEE = kes(800);

/**
 * The single source of prices. The customer app asks for it through
 * PricingService to show the price; the backend calls it again at booking
 * with its live catalog, so nobody can book at a price it didn't set.
 * Service categories with no active catalog package are QUOTED.
 */
export function calculateEstimate(
  details: JobRequestDetails,
  callOutFee: Cents = CALL_OUT_FEE,
  catalog: Catalog = DEFAULT_CATALOG,
): PriceEstimate {
  const price =
    details.requestType === 'service'
      ? priceFixedService(catalog, details.categoryId, details.vehicle)
      : undefined;
  if (!price) {
    return { pricingMode: 'QUOTED', callOut: callOutFee };
  }
  // Parts come with the mechanic unless the customer said they have them.
  const partsOption =
    details.partsOption === 'OWN' && price.parts.length > 0 ? 'OWN' : 'MECHANIC';
  return {
    pricingMode: 'FIXED',
    callOut: callOutFee,
    fixedService: { ...price, partsOption, total: fixedTotal(price, partsOption) },
  };
}
