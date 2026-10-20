import { Cents } from '../money';
import { MoneyPurpose, ReleaseLine } from './types';

/** Fundi-X's cut per kind of money, in basis points (1 bp = 0.01%). */
export type CommissionRates = Record<MoneyPurpose, number>;

/**
 * The default rates, so each rate is an integer: 2000 bp = 20%. Fundi-X
 * earns on the call-out and labour; parts the mechanic buys for the
 * customer carry a small 5% handling fee. The server's live values are
 * settings staff can change.
 */
export const COMMISSION_BPS: CommissionRates = {
  CALL_OUT: 2000,
  SERVICE: 2000,
  PARTS: 500,
};

export function commissionOn(
  amount: Cents,
  purpose: MoneyPurpose,
  rates: CommissionRates = COMMISSION_BPS,
): Cents {
  return Math.round((amount * rates[purpose]) / 10_000);
}

/** e.g. 2000 bp → "20%" */
export function formatRate(purpose: MoneyPurpose, rates: CommissionRates = COMMISSION_BPS) {
  return `${rates[purpose] / 100}%`;
}

/** One payment's share of money going to the provider, with Fundi-X's cut. */
export const releaseLine = (
  paymentId: string,
  purpose: MoneyPurpose,
  gross: Cents,
  rates: CommissionRates = COMMISSION_BPS,
): ReleaseLine => ({
  paymentId,
  purpose,
  gross,
  commission: commissionOn(gross, purpose, rates),
});
