import { JobCategory } from '../types';

export const CATEGORIES: JobCategory[] = [
  // ---- Repair ----
  {
    id: 'engine',
    requestType: 'repair',
    label: 'Engine & performance',
    description: 'Misfiring, overheating, loss of power...',
    questions: ['engine.symptoms', 'common.since'],
    mediaHint: 'helpful',
  },
  {
    id: 'electrical',
    requestType: 'repair',
    label: 'Electrical',
    description: 'Battery, lights, starting, wiring...',
    questions: ['electrical.symptoms', 'common.since'],
    mediaHint: 'helpful',
  },
  {
    id: 'brakes',
    requestType: 'repair',
    label: 'Brakes',
    description: 'Noise, vibration, weak braking...',
    questions: ['brakes.symptoms', 'common.since'],
    mediaHint: 'helpful',
  },
  {
    id: 'suspension',
    requestType: 'repair',
    label: 'Suspension & steering',
    description: 'Shaking, pulling, knocking...',
    questions: ['suspension.symptoms', 'common.since'],
    mediaHint: 'helpful',
  },
  {
    id: 'transmission',
    requestType: 'repair',
    label: 'Transmission',
    description: 'Gear shifting, slipping, noises...',
    questions: ['transmission.symptoms', 'common.since'],
    mediaHint: 'helpful',
  },
  {
    id: 'ac',
    requestType: 'repair',
    label: 'Air conditioning',
    description: 'Not cooling, weak airflow...',
    questions: ['ac.symptoms', 'common.since'],
    mediaHint: 'optional',
  },
  {
    id: 'diagnostics',
    requestType: 'repair',
    label: 'Diagnostics',
    description: 'Warning light or unknown problem',
    questions: ['diagnostics.light', 'common.since'],
    mediaHint: 'helpful',
  },
  {
    id: 'body',
    requestType: 'repair',
    label: 'Body / accident',
    description: 'Collision, dents, body damage...',
    questions: ['body.damage', 'body.when'],
    mediaHint: 'essential',
  },
  {
    id: 'other_repair',
    requestType: 'repair',
    label: 'Something else',
    description: "Not sure? Tell us what you've noticed.",
    questions: ['common.since'],
    mediaHint: 'helpful',
  },

  // ---- Service ----
  {
    id: 'routine_service',
    requestType: 'service',
    label: 'Routine service',
    questions: ['service.last_service'],
    mediaHint: 'optional',
  },
  {
    id: 'oil_service',
    requestType: 'service',
    label: 'Oil & filter change',
    questions: ['service.last_service'],
    mediaHint: 'optional',
  },
  {
    id: 'brake_service',
    requestType: 'service',
    label: 'Brake service',
    questions: ['service.brake_issues'],
    mediaHint: 'optional',
  },
  {
    id: 'ac_service',
    requestType: 'service',
    label: 'AC service',
    questions: ['service.ac_issues'],
    mediaHint: 'optional',
  },
  {
    id: 'inspection',
    requestType: 'service',
    label: 'Inspection',
    questions: ['service.inspection_reason'],
    mediaHint: 'optional',
  },
  {
    id: 'pre_trip',
    requestType: 'service',
    label: 'Pre-trip check',
    questions: ['service.trip_length'],
    mediaHint: 'optional',
  },
  {
    id: 'other_service',
    requestType: 'service',
    label: 'Other service',
    questions: [],
    mediaHint: 'optional',
  },
];

/**
 * Fixed-price packages Fundi-X added in the admin portal after this app
 * version was built: they're offered as services too, with no questions.
 */
let addedServices: JobCategory[] = [];

export function setOfferedServices(packages: { id: string; name: string }[]) {
  addedServices = packages
    .filter(p => !CATEGORIES.some(c => c.id === p.id))
    .map(p => ({
      id: p.id,
      requestType: 'service',
      label: p.name,
      questions: [],
      mediaHint: 'optional',
    }));
}

/** The categories to offer, with added services before "Other service". */
export function categoriesFor(requestType: JobCategory['requestType'] | undefined) {
  const base = CATEGORIES.filter(c => c.requestType === requestType);
  if (requestType !== 'service') {
    return base;
  }
  const other = base.filter(c => c.id === 'other_service');
  return [...base.filter(c => c.id !== 'other_service'), ...addedServices, ...other];
}

/**
 * A category by id. An id this app doesn't know (a package added later)
 * still gets a readable label from the id itself.
 */
export function getCategory(id: string | undefined): JobCategory | undefined {
  if (!id) {
    return undefined;
  }
  const known =
    CATEGORIES.find(c => c.id === id) ?? addedServices.find(c => c.id === id);
  if (known) {
    return known;
  }
  const words = id.replace(/_/g, ' ');
  return {
    id,
    requestType: 'service',
    label: words.charAt(0).toUpperCase() + words.slice(1),
    questions: [],
    mediaHint: 'optional',
  };
}
