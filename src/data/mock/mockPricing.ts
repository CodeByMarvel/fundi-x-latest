import { JobRequestDetails } from '../../domain/jobs/types';
import { Cents, kes } from '../../domain/money';
import { PriceEstimate } from '../../domain/pricing/PricingService';
import { QuoteItemInput } from '../../domain/quotes/types';

// Call-out = base + distance component (docs/job-flow.md §3.2).
export const CALL_OUT_BASE = kes(500);
/**
 * OPEN: the distance formula isn't decided yet. Until it is, everyone pays
 * the same distance component, as if all jobs were in one Nairobi zone.
 */
export const CALL_OUT_DISTANCE = kes(300);

type Package = { name: string; items: QuoteItemInput[] };

const item = (
  kind: QuoteItemInput['kind'],
  description: string,
  shillings: number,
  quantity = 1,
): QuoteItemInput => ({
  kind,
  description,
  quantity,
  unitPrice: kes(shillings),
});

/**
 * The Fundi-X maintenance catalog: what a standard job costs on a typical
 * car. Temporary by design: it's replaced by a data-driven model once enough
 * real jobs (and additional quotes showing where it was wrong) are recorded.
 * Categories missing from here (e.g. "Other service") are QUOTED instead.
 */
const CATALOG: Record<string, Package> = {
  routine_service: {
    name: 'Full service',
    items: [
      item('PART', 'Engine oil 5W-30 (4L)', 4200),
      item('PART', 'Oil filter', 900),
      item('PART', 'Air filter', 1200),
      item('CONSUMABLE', 'Washers, cleaners & top-ups', 300),
      item('LABOUR', 'Full service labour', 1500),
    ],
  },
  oil_service: {
    name: 'Oil & filter change',
    items: [
      item('PART', 'Engine oil 5W-30 (4L)', 3800),
      item('PART', 'Oil filter', 900),
      item('LABOUR', 'Oil and filter change', 1000),
    ],
  },
  brake_service: {
    name: 'Brake service',
    items: [
      item('PART', 'Brake fluid DOT 4 (1L)', 1200),
      item('LABOUR', 'Brake inspection, clean & fluid flush', 2500),
    ],
  },
  ac_service: {
    name: 'AC service',
    items: [
      item('CONSUMABLE', 'Refrigerant regas', 3500),
      item('LABOUR', 'AC check and regas', 1500),
    ],
  },
  inspection: {
    name: 'Vehicle inspection',
    items: [item('LABOUR', 'Multi-point inspection with report', 2500)],
  },
  pre_trip: {
    name: 'Pre-trip check',
    items: [
      item('LABOUR', 'Pre-trip safety check', 1500),
      item('CONSUMABLE', 'Fluid top-ups', 500),
    ],
  },
};

/** Premium makes have pricier parts. A first, crude vehicle adjustment. */
const PREMIUM_MAKES = ['mercedes-benz', 'bmw', 'audi', 'lexus', 'land rover'];
const PREMIUM_PARTS_FACTOR = 1.5;

/** Rounds to whole shillings, so prices look like prices. */
const toShillings = (cents: number): Cents => Math.round(cents / 100) * 100;

/**
 * The single source of prices. The customer app calls it (through
 * PricingService) to show the price; the backend calls it again when the
 * job is booked, so a customer can never book at a price it didn't set.
 */
export function calculateEstimate(details: JobRequestDetails): PriceEstimate {
  const callOutBreakdown = { base: CALL_OUT_BASE, distance: CALL_OUT_DISTANCE };
  const callOut = CALL_OUT_BASE + CALL_OUT_DISTANCE;

  const pkg =
    details.requestType === 'service' ? CATALOG[details.categoryId] : undefined;
  if (!pkg) {
    return { pricingMode: 'QUOTED', callOut, callOutBreakdown };
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
    callOut,
    callOutBreakdown,
    fixedService: { packageName: pkg.name, items, total },
  };
}
