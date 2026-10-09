import { Release } from '../domain/billing/types';
import { Cents } from '../domain/money';

/**
 * Earnings are releases from escrow: a record created when a job ends and
 * the money is paid out. They're facts, not something recalculated from
 * jobs, so a later change to commission rates can't rewrite history.
 */
export function sumNet(releases: Release[]): Cents {
  return releases.reduce((sum, r) => sum + r.net, 0);
}

export function sumCommission(releases: Release[]): Cents {
  return releases.reduce((sum, r) => sum + r.commission, 0);
}

export function isToday(iso: string, now = new Date()) {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
