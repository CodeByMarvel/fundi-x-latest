import { Cents } from '../money';
import { MoneyPurpose } from './types';

/**
 * Fundi-X's cut, per kind of money, in basis points (1 bp = 0.01%), so the
 * rate is an integer too: 2000 bp = 20%. Kept per purpose because call-out
 * and service economics may diverge later.
 */
export const COMMISSION_BPS: Record<MoneyPurpose, number> = {
  CALL_OUT: 2000,
  SERVICE: 2000,
};

export function commissionOn(amount: Cents, purpose: MoneyPurpose): Cents {
  return Math.round((amount * COMMISSION_BPS[purpose]) / 10_000);
}

/** e.g. 2000 bp → "20%" */
export function formatRate(purpose: MoneyPurpose) {
  return `${COMMISSION_BPS[purpose] / 100}%`;
}
