import { Cents } from '../money';

/**
 * Fundi-X's cut of each job, in basis points (1 bp = 0.01%), so the rate is
 * an integer too: 1000 bp = 10%.
 */
export const COMMISSION_BPS = 1000;

export function commissionOn(amount: Cents): Cents {
  return Math.round((amount * COMMISSION_BPS) / 10_000);
}

/** What the provider takes home from a payment. */
export function providerPayout(amount: Cents): Cents {
  return amount - commissionOn(amount);
}
