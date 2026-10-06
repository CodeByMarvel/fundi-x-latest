import { Vehicle } from '../request/types';

/** Placeholder garage until vehicles come from the backend. */
export const mockVehicles: Vehicle[] = [
  {
    id: 'v1',
    year: 2015,
    make: 'Toyota',
    model: 'Fielder',
    registration: 'KDA 123A',
  },
  {
    id: 'v2',
    year: 2018,
    make: 'Mercedes-Benz',
    model: 'C200',
    registration: 'KXX 456B',
  },
];

export function vehicleName(v: Vehicle) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ');
}
