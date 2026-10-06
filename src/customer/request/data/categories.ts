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

export function getCategory(id: string | undefined) {
  return CATEGORIES.find(c => c.id === id);
}
