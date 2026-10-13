import { JobRequestDetails } from '../jobs/types';
import { Cents, kes } from '../money';
import { PriceEstimate } from './PricingService';
import { line } from '../quotes/quotes';
import { QuoteItemInput } from '../quotes/types';

/**
 * The default call-out fee. Flat on purpose: H3 ring-limited matching caps
 * how far a provider can be sent, so one fee is fair (docs/job-flow.md
 * §3.1). The server passes the live value from its `settings` table, so
 * changing it is a data change, not a code change.
 */
export const CALL_OUT_FEE = kes(800);

type Package = { name: string; items: QuoteItemInput[] };

/**
 * The Fundi-X maintenance catalog (stands in for the backend's packages and
 * prices tables). Temporary by design: it's replaced by a data-driven model
 * once enough real jobs are recorded. Categories missing from here (e.g.
 * "Other service") are QUOTED instead.
 */
const CATALOG: Record<string, Package> = {
  routine_service: {
    name: 'Full service',
    items: [
      line('ENGINE_OIL', 4200),
      line('OIL_FILTER', 900),
      line('AIR_FILTER', 1200),
      line('WORKSHOP_CONSUMABLES', 300),
      line('LABOUR_FULL_SERVICE', 1500),
    ],
  },
  oil_service: {
    name: 'Oil & filter change',
    items: [
      line('ENGINE_OIL', 3800),
      line('OIL_FILTER', 900),
      line('LABOUR_OIL_CHANGE', 1000),
    ],
  },
  brake_service: {
    name: 'Brake service',
    items: [line('BRAKE_FLUID', 1200), line('LABOUR_BRAKE_SERVICE', 2500)],
  },
  ac_service: {
    name: 'AC service',
    items: [line('AC_REFRIGERANT', 3500), line('LABOUR_AC_SERVICE', 1500)],
  },
  inspection: {
    name: 'Vehicle inspection',
    items: [line('LABOUR_INSPECTION', 2500)],
  },
  pre_trip: {
    name: 'Pre-trip check',
    items: [line('LABOUR_INSPECTION', 1500), line('TOP_UPS', 500)],
  },
};

/** Premium makes have pricier parts. A first, crude vehicle adjustment. */
const PREMIUM_MAKES = ['mercedes-benz', 'bmw', 'audi', 'lexus', 'land rover'];
const PREMIUM_PARTS_FACTOR = 1.5;

/** Rounds to whole shillings, so prices look like prices. */
const toShillings = (cents: number): Cents => Math.round(cents / 100) * 100;

/**
 * The single source of prices (stands in for the backend's pricing engine).
 * The customer app asks for it through PricingService to show the price; the
 * backend calls it again at booking, so nobody can book at a price it
 * didn't set.
 */
export function calculateEstimate(
  details: JobRequestDetails,
  callOutFee: Cents = CALL_OUT_FEE,
): PriceEstimate {
  const pkg =
    details.requestType === 'service' ? CATALOG[details.categoryId] : undefined;
  if (!pkg) {
    return { pricingMode: 'QUOTED', callOut: callOutFee };
  }

  const premium = PREMIUM_MAKES.includes(details.vehicle.make.toLowerCase());
  const items = pkg.items.map(i => ({
    ...i,
    unitPrice:
      premium && i.kind === 'PART'
        ? toShillings(i.unitPrice * PREMIUM_PARTS_FACTOR)
        : i.unitPrice,
  }));
  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  return {
    pricingMode: 'FIXED',
    callOut: callOutFee,
    fixedService: { packageName: pkg.name, items, total },
  };
}
