import type { Fuel, Vehicle } from '../jobs/request';
import { Cents, kes } from '../money';
import { serviceCode } from '../quotes/serviceCodes';
import type { QuoteItemInput, QuoteItemKind } from '../quotes/types';

/**
 * The maintenance catalog (docs/job-flow.md §3.2). Fundi-X prices labour
 * per package and vehicle class; parts are an optional add-on the customer
 * chooses at booking. The server keeps the live catalog in its database and
 * staff edit it in the admin portal; DEFAULT_CATALOG below is the starting
 * data and what the app's demo mode uses.
 */

/**
 * Vehicle classes, smallest first. Engine size and fuel drive what a
 * service costs (oil volume, filter size, labour time), so labour and parts
 * are priced per class.
 */
export const VEHICLE_CLASSES = [
  'SMALL',
  'MEDIUM',
  'LARGE',
  'FOUR_X4',
  'PREMIUM',
] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  SMALL: 'Small car (up to 1,500 cc)',
  MEDIUM: 'Medium car (1,501–2,000 cc)',
  LARGE: 'Large car / SUV (2,001–3,000 cc)',
  FOUR_X4: '4x4 / diesel (over 3,000 cc or diesel)',
  PREMIUM: 'Premium make',
};

export type { Fuel };

/** A model's usual engine, for customers who don't know theirs. */
export type ModelSpec = {
  make: string;
  model: string;
  engineCc: number;
  fuel: Fuel;
};

/** What one line costs for one class. */
export type ClassPrice = { quantity: number; unitPrice: Cents };

/**
 * One line of a package. Kind PART lines are the optional parts; every
 * other kind (labour, consumables) is always included. A class with no
 * price doesn't need the line (e.g. no spark plugs on a diesel).
 */
export type CatalogItem = {
  serviceCode: string;
  kind: QuoteItemKind;
  description: string;
  prices: Partial<Record<VehicleClass, ClassPrice>>;
};

/** A fixed-price service. `id` is the app's service category id. */
export type CatalogPackage = {
  id: string;
  name: string;
  /** Inactive packages are QUOTED, as if they weren't in the catalog. */
  active: boolean;
  items: CatalogItem[];
};

export type Catalog = {
  packages: CatalogPackage[];
  models: ModelSpec[];
  /** Makes priced as PREMIUM whatever the engine, lower case. */
  premiumMakes: string[];
};

/** Who supplies the parts on a fixed-price job. */
export type PartsOption = 'MECHANIC' | 'OWN';

/** Whether a line belongs to the optional parts. */
export const isPartLine = (kind: QuoteItemKind) => kind === 'PART';

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/[\s-]+/g, ' ') ===
  b.trim().toLowerCase().replace(/[\s-]+/g, ' ');

export function findModel(catalog: Catalog, vehicle: Pick<Vehicle, 'make' | 'model'>) {
  return catalog.models.find(
    m => sameText(m.make, vehicle.make) && sameText(m.model, vehicle.model),
  );
}

/** How the class was decided, shown in the admin portal. */
export type ClassSource = 'make' | 'vehicle' | 'model_lookup' | 'default';

/**
 * The vehicle's class: premium makes first, then the engine the customer
 * gave, then the model's usual engine. Unknown cars are priced as MEDIUM;
 * the mechanic sees the car and support can correct a wrong class.
 */
export function classify(
  catalog: Catalog,
  vehicle: Vehicle,
): { vehicleClass: VehicleClass; source: ClassSource } {
  if (catalog.premiumMakes.includes(vehicle.make.trim().toLowerCase())) {
    return { vehicleClass: 'PREMIUM', source: 'make' };
  }
  const model = findModel(catalog, vehicle);
  const engineCc = vehicle.engineCc ?? model?.engineCc;
  const fuel = vehicle.fuel ?? model?.fuel;
  if (engineCc === undefined && fuel === undefined) {
    return { vehicleClass: 'MEDIUM', source: 'default' };
  }
  const source: ClassSource =
    vehicle.engineCc !== undefined || vehicle.fuel !== undefined
      ? 'vehicle'
      : 'model_lookup';
  if (fuel === 'diesel' || (engineCc ?? 0) > 3000) {
    return { vehicleClass: 'FOUR_X4', source };
  }
  if (engineCc === undefined || engineCc > 1500) {
    return {
      vehicleClass: engineCc === undefined || engineCc <= 2000 ? 'MEDIUM' : 'LARGE',
      source,
    };
  }
  return { vehicleClass: 'SMALL', source };
}

/** A package priced for one vehicle. */
export type FixedServicePrice = {
  packageId: string;
  packageName: string;
  vehicleClass: VehicleClass;
  /** Labour and consumables: always included. */
  items: QuoteItemInput[];
  /** The optional parts. */
  parts: QuoteItemInput[];
  serviceTotal: Cents;
  partsTotal: Cents;
};

const lineTotal = (items: QuoteItemInput[]) =>
  items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

/** The package for a service category, or undefined if it's QUOTED. */
export function priceFixedService(
  catalog: Catalog,
  categoryId: string,
  vehicle: Vehicle,
): FixedServicePrice | undefined {
  const pkg = catalog.packages.find(p => p.id === categoryId && p.active);
  if (!pkg) {
    return undefined;
  }
  const { vehicleClass } = classify(catalog, vehicle);
  const lines: QuoteItemInput[] = [];
  for (const item of pkg.items) {
    const price = item.prices[vehicleClass];
    if (price) {
      lines.push({
        serviceCode: item.serviceCode,
        kind: item.kind,
        description: item.description,
        quantity: price.quantity,
        unitPrice: price.unitPrice,
      });
    }
  }
  // A package with nothing for this class can't be fixed-priced.
  if (lines.length === 0) {
    return undefined;
  }
  const items = lines.filter(l => !isPartLine(l.kind));
  const parts = lines.filter(l => isPartLine(l.kind));
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    vehicleClass,
    items,
    parts,
    serviceTotal: lineTotal(items),
    partsTotal: lineTotal(parts),
  };
}

/** What the customer pays for the work with the chosen parts option. */
export const fixedTotal = (
  price: Pick<FixedServicePrice, 'serviceTotal' | 'partsTotal'>,
  option: PartsOption | undefined,
) => price.serviceTotal + (option === 'OWN' ? 0 : price.partsTotal);

/** Problems with the model list, fit to show staff; empty if it's fine. */
export function modelProblems(models: ModelSpec[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of models) {
    const name = `${m.make} ${m.model}`.trim();
    if (!m.make.trim() || !m.model.trim()) {
      problems.push('Every model needs a make and a model name.');
    }
    if (!Number.isInteger(m.engineCc) || m.engineCc < 50 || m.engineCc > 10000) {
      problems.push(`${name}: engine size must be a whole number of cc (50 to 10,000).`);
    }
    if (!['petrol', 'diesel', 'hybrid', 'electric'].includes(m.fuel)) {
      problems.push(`${name}: unknown fuel ${m.fuel}.`);
    }
    const key = `${m.make}|${m.model}`.toLowerCase().replace(/[\s-]+/g, ' ');
    if (seen.has(key)) {
      problems.push(`${name} is listed twice.`);
    }
    seen.add(key);
  }
  return problems;
}

/** Problems with a package, fit to show staff; empty if it's fine. */
export function packageProblems(pkg: CatalogPackage): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]{1,48}$/.test(pkg.id)) {
    problems.push('The id must be lower-case letters, digits and _ (e.g. "battery_service").');
  }
  if (!pkg.name.trim()) {
    problems.push('Give the package a name.');
  }
  if (pkg.items.length === 0) {
    problems.push('Add at least one line.');
  }
  for (const item of pkg.items) {
    const name = item.description.trim() || item.serviceCode;
    if (!['PART', 'LABOUR', 'CONSUMABLE', 'OTHER'].includes(item.kind)) {
      problems.push(`"${name}": unknown kind ${item.kind}.`);
    }
    if (item.serviceCode !== 'OTHER' && !serviceCode(item.serviceCode)) {
      problems.push(`"${name}": unknown service code ${item.serviceCode}.`);
    }
    if (!item.description.trim()) {
      problems.push(`A ${item.serviceCode} line needs a description.`);
    }
    for (const [cls, price] of Object.entries(item.prices)) {
      if (!VEHICLE_CLASSES.includes(cls as VehicleClass)) {
        problems.push(`"${name}": unknown vehicle class ${cls}.`);
      } else if (
        !price ||
        !Number.isInteger(price.quantity) ||
        price.quantity < 1 ||
        !Number.isInteger(price.unitPrice) ||
        price.unitPrice <= 0 ||
        price.unitPrice % 100 !== 0
      ) {
        problems.push(
          `"${name}" (${cls}): quantity must be a whole number from 1, and the price whole shillings above zero.`,
        );
      }
    }
  }
  if (!pkg.items.some(i => !isPartLine(i.kind))) {
    problems.push('Add a labour line: Fundi-X prices labour; parts are optional.');
  }
  return problems;
}

// ---- Starting data -------------------------------------------------------

/** Same price for every class. */
const flat = (shillings: number, quantity = 1) =>
  Object.fromEntries(
    VEHICLE_CLASSES.map(c => [c, { quantity, unitPrice: kes(shillings) }]),
  ) as Record<VehicleClass, ClassPrice>;

/** One price per class, in VEHICLE_CLASSES order. */
const byClass = (
  shillings: [number, number, number, number, number],
  quantities: [number, number, number, number, number] = [1, 1, 1, 1, 1],
) =>
  Object.fromEntries(
    VEHICLE_CLASSES.map((c, i) => [
      c,
      { quantity: quantities[i], unitPrice: kes(shillings[i]) },
    ]),
  ) as Record<VehicleClass, ClassPrice>;

const item = (
  code: string,
  prices: CatalogItem['prices'],
  description?: string,
): CatalogItem => {
  const known = serviceCode(code)!;
  return {
    serviceCode: code,
    kind: known.kind,
    description: description ?? known.label,
    prices,
  };
};

/** Litres of engine oil per class, and the price per litre. */
const OIL_LITRES: [number, number, number, number, number] = [4, 4, 5, 7, 6];
const engineOil = item(
  'ENGINE_OIL',
  byClass([1000, 1000, 1000, 1000, 1800], OIL_LITRES),
  'Engine oil (per litre)',
);
const oilFilter = item('OIL_FILTER', byClass([900, 900, 1100, 1500, 2500]));
const airFilter = item('AIR_FILTER', byClass([1200, 1300, 1600, 2200, 3500]));

/**
 * Starting prices, in shillings. Parts are set about 5% above what a
 * mechanic pays, so the 5% parts commission doesn't leave them short.
 * Staff change all of this in the admin portal.
 */
export const DEFAULT_CATALOG: Catalog = {
  packages: [
    {
      id: 'routine_service',
      name: 'Full service',
      active: true,
      items: [
        item('LABOUR_FULL_SERVICE', byClass([1500, 1800, 2200, 2800, 3000])),
        item('WORKSHOP_CONSUMABLES', flat(300)),
        engineOil,
        oilFilter,
        airFilter,
      ],
    },
    {
      id: 'oil_service',
      name: 'Oil & filter change',
      active: true,
      items: [
        item('LABOUR_OIL_CHANGE', byClass([800, 1000, 1200, 1500, 1500])),
        engineOil,
        oilFilter,
      ],
    },
    {
      id: 'brake_service',
      name: 'Brake service',
      active: true,
      items: [
        item('LABOUR_BRAKE_SERVICE', byClass([2000, 2500, 2800, 3200, 3500])),
        item('BRAKE_FLUID', byClass([1200, 1200, 1200, 1500, 1800])),
      ],
    },
    {
      id: 'ac_service',
      name: 'AC service',
      active: true,
      items: [
        item('LABOUR_AC_SERVICE', byClass([1500, 1500, 1800, 2200, 2500])),
        item('AC_REFRIGERANT', byClass([3500, 3500, 4000, 4500, 5000])),
      ],
    },
    {
      id: 'inspection',
      name: 'Vehicle inspection',
      active: true,
      items: [item('LABOUR_INSPECTION', byClass([2000, 2500, 2500, 3000, 3500]))],
    },
    {
      id: 'pre_trip',
      name: 'Pre-trip check',
      active: true,
      items: [
        item('LABOUR_INSPECTION', byClass([1200, 1500, 1500, 2000, 2000]), 'Pre-trip check'),
        item('TOP_UPS', flat(500)),
      ],
    },
  ],
  models: [
    { make: 'Toyota', model: 'Vitz', engineCc: 1000, fuel: 'petrol' },
    { make: 'Toyota', model: 'Passo', engineCc: 1000, fuel: 'petrol' },
    { make: 'Toyota', model: 'Fielder', engineCc: 1500, fuel: 'petrol' },
    { make: 'Toyota', model: 'Axio', engineCc: 1500, fuel: 'petrol' },
    { make: 'Toyota', model: 'Probox', engineCc: 1500, fuel: 'petrol' },
    { make: 'Toyota', model: 'Sienta', engineCc: 1500, fuel: 'petrol' },
    { make: 'Toyota', model: 'Premio', engineCc: 1800, fuel: 'petrol' },
    { make: 'Toyota', model: 'Allion', engineCc: 1800, fuel: 'petrol' },
    { make: 'Toyota', model: 'Noah', engineCc: 2000, fuel: 'petrol' },
    { make: 'Toyota', model: 'Voxy', engineCc: 2000, fuel: 'petrol' },
    { make: 'Toyota', model: 'Harrier', engineCc: 2400, fuel: 'petrol' },
    { make: 'Toyota', model: 'RAV4', engineCc: 2000, fuel: 'petrol' },
    { make: 'Toyota', model: 'Hilux', engineCc: 2400, fuel: 'diesel' },
    { make: 'Toyota', model: 'Prado', engineCc: 3000, fuel: 'diesel' },
    { make: 'Toyota', model: 'Land Cruiser', engineCc: 4500, fuel: 'diesel' },
    { make: 'Nissan', model: 'Note', engineCc: 1200, fuel: 'petrol' },
    { make: 'Nissan', model: 'March', engineCc: 1200, fuel: 'petrol' },
    { make: 'Nissan', model: 'Tiida', engineCc: 1500, fuel: 'petrol' },
    { make: 'Nissan', model: 'X-Trail', engineCc: 2000, fuel: 'petrol' },
    { make: 'Nissan', model: 'Navara', engineCc: 2500, fuel: 'diesel' },
    { make: 'Mazda', model: 'Demio', engineCc: 1300, fuel: 'petrol' },
    { make: 'Mazda', model: 'Axela', engineCc: 1500, fuel: 'petrol' },
    { make: 'Mazda', model: 'CX-5', engineCc: 2000, fuel: 'petrol' },
    { make: 'Honda', model: 'Fit', engineCc: 1300, fuel: 'petrol' },
    { make: 'Honda', model: 'CR-V', engineCc: 2000, fuel: 'petrol' },
    { make: 'Subaru', model: 'Impreza', engineCc: 1500, fuel: 'petrol' },
    { make: 'Subaru', model: 'Forester', engineCc: 2000, fuel: 'petrol' },
    { make: 'Subaru', model: 'Outback', engineCc: 2500, fuel: 'petrol' },
    { make: 'Mitsubishi', model: 'Outlander', engineCc: 2000, fuel: 'petrol' },
    { make: 'Mitsubishi', model: 'Pajero', engineCc: 3200, fuel: 'diesel' },
    { make: 'Isuzu', model: 'D-Max', engineCc: 2500, fuel: 'diesel' },
    { make: 'Volkswagen', model: 'Golf', engineCc: 1400, fuel: 'petrol' },
  ],
  premiumMakes: ['mercedes-benz', 'bmw', 'audi', 'lexus', 'land rover', 'porsche', 'volvo'],
};
