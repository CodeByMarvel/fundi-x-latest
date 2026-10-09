import { QuoteItemKind } from './types';

export type ServiceCode = {
  code: string;
  label: string;
  /** The kind of line this code is normally used for. */
  kind: QuoteItemKind;
};

/** For anything not on the list. The description then says what it is. */
export const OTHER_CODE = 'OTHER';

/**
 * The standard names for work and parts. Every quote line carries one, so
 * prices can later be compared across jobs and providers ("typical approved
 * price for BRAKE_PAD_FRONT on a 2015 Fielder") instead of guessed from free
 * text. In the real backend this list is a database table that grows over
 * time; adding a code never breaks old quotes.
 */
export const SERVICE_CODES: ServiceCode[] = [
  // Parts
  { code: 'BRAKE_PAD_FRONT', label: 'Brake pads (front)', kind: 'PART' },
  { code: 'BRAKE_PAD_REAR', label: 'Brake pads (rear)', kind: 'PART' },
  { code: 'BRAKE_DISC_FRONT', label: 'Brake discs (front)', kind: 'PART' },
  { code: 'BRAKE_FLUID', label: 'Brake fluid', kind: 'PART' },
  { code: 'ENGINE_OIL', label: 'Engine oil', kind: 'PART' },
  { code: 'OIL_FILTER', label: 'Oil filter', kind: 'PART' },
  { code: 'AIR_FILTER', label: 'Air filter', kind: 'PART' },
  { code: 'CABIN_FILTER', label: 'Cabin filter', kind: 'PART' },
  { code: 'SPARK_PLUG', label: 'Spark plug', kind: 'PART' },
  { code: 'BATTERY', label: 'Battery', kind: 'PART' },
  {
    code: 'SHOCK_ABSORBER_FRONT',
    label: 'Shock absorber (front)',
    kind: 'PART',
  },
  { code: 'WIPER_BLADE', label: 'Wiper blade', kind: 'PART' },
  // Consumables
  { code: 'AC_REFRIGERANT', label: 'AC refrigerant', kind: 'CONSUMABLE' },
  { code: 'COOLANT', label: 'Coolant', kind: 'CONSUMABLE' },
  { code: 'TOP_UPS', label: 'Fluid top-ups', kind: 'CONSUMABLE' },
  {
    code: 'WORKSHOP_CONSUMABLES',
    label: 'Washers, cleaners & sundries',
    kind: 'CONSUMABLE',
  },
  // Labour
  { code: 'LABOUR_BRAKE_PADS', label: 'Replace brake pads', kind: 'LABOUR' },
  { code: 'LABOUR_BRAKE_SERVICE', label: 'Brake service', kind: 'LABOUR' },
  { code: 'LABOUR_OIL_CHANGE', label: 'Oil & filter change', kind: 'LABOUR' },
  { code: 'LABOUR_FULL_SERVICE', label: 'Full service', kind: 'LABOUR' },
  { code: 'LABOUR_AC_SERVICE', label: 'AC service', kind: 'LABOUR' },
  { code: 'LABOUR_SPARK_PLUGS', label: 'Replace spark plugs', kind: 'LABOUR' },
  { code: 'LABOUR_BATTERY', label: 'Fit battery', kind: 'LABOUR' },
  { code: 'LABOUR_SHOCKS', label: 'Replace shock absorbers', kind: 'LABOUR' },
  { code: 'LABOUR_DIAGNOSTICS', label: 'Diagnostics', kind: 'LABOUR' },
  { code: 'LABOUR_INSPECTION', label: 'Vehicle inspection', kind: 'LABOUR' },
  { code: 'LABOUR_GENERAL', label: 'General repair labour', kind: 'LABOUR' },
];

export function serviceCode(code: string) {
  return SERVICE_CODES.find(c => c.code === code);
}

/** Codes offered for a kind of line, most specific first, "Other" last. */
export function codesForKind(kind: QuoteItemKind) {
  return SERVICE_CODES.filter(c => c.kind === kind);
}

export function isKnownCode(code: string) {
  return code === OTHER_CODE || !!serviceCode(code);
}
