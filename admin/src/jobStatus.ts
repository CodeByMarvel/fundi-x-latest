import type { JobStatus } from './api';

/** How each status reads, and its colour family. Order follows job-flow.md §5. */
export const STATUS: Record<
  JobStatus,
  { label: string; tone: 'wait' | 'active' | 'done' | 'off' | 'bad' }
> = {
  CALL_OUT_PAYMENT_PENDING: { label: 'Awaiting call-out payment', tone: 'wait' },
  SEARCHING: { label: 'Finding a mechanic', tone: 'active' },
  OFFERED: { label: 'Offered to mechanic', tone: 'active' },
  ACCEPTED: { label: 'Accepted', tone: 'active' },
  EN_ROUTE: { label: 'On the way', tone: 'active' },
  ARRIVED: { label: 'Arrived', tone: 'active' },
  DIAGNOSING: { label: 'Diagnosing', tone: 'active' },
  QUOTE_SENT: { label: 'Quote sent', tone: 'wait' },
  SERVICE_PAYMENT_PENDING: { label: 'Awaiting service payment', tone: 'wait' },
  IN_PROGRESS: { label: 'Work in progress', tone: 'active' },
  AWAITING_CONFIRMATION: { label: 'Awaiting confirmation', tone: 'wait' },
  COMPLETED: { label: 'Completed', tone: 'done' },
  CANCELLED: { label: 'Cancelled', tone: 'off' },
  DISPUTED: { label: 'Disputed', tone: 'bad' },
};

export const ALL_STATUSES = Object.keys(STATUS) as JobStatus[];

/**
 * The main path a job travels (docs/admin-portal.md §4). FIXED jobs skip
 * diagnosis and quoting: Fundi-X priced them before booking.
 */
export function mainPath(pricingMode: 'FIXED' | 'QUOTED'): JobStatus[] {
  const quoted: JobStatus[] = ['DIAGNOSING', 'QUOTE_SENT'];
  return [
    'CALL_OUT_PAYMENT_PENDING',
    'SEARCHING',
    'OFFERED',
    'ACCEPTED',
    'EN_ROUTE',
    'ARRIVED',
    ...(pricingMode === 'QUOTED' ? quoted : []),
    'SERVICE_PAYMENT_PENDING',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'COMPLETED',
  ];
}

/** Dashboard groups: stages people think in, built from statuses. */
export const STAGES: { label: string; statuses: JobStatus[] }[] = [
  { label: 'Awaiting payment', statuses: ['CALL_OUT_PAYMENT_PENDING', 'SERVICE_PAYMENT_PENDING'] },
  { label: 'Finding a mechanic', statuses: ['SEARCHING', 'OFFERED'] },
  { label: 'Mechanic on the way', statuses: ['ACCEPTED', 'EN_ROUTE'] },
  { label: 'On site', statuses: ['ARRIVED', 'DIAGNOSING', 'QUOTE_SENT', 'IN_PROGRESS'] },
  { label: 'Awaiting confirmation', statuses: ['AWAITING_CONFIRMATION'] },
  { label: 'Disputed', statuses: ['DISPUTED'] },
];
