import { Vehicle } from '../request/types';

/** Demo mode's sample vehicles. Signed in, they come from the server. */
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
