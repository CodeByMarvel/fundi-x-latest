/**
 * Money is always a whole number of cents (KES × 100). Decimal fractions
 * like 0.1 can't be stored exactly as floating point numbers, so adding
 * shillings as decimals slowly drifts; adding integers never does.
 */
export type Cents = number;

export function kes(shillings: number): Cents {
  return Math.round(shillings * 100);
}

/** e.g. 450000 → "KSh 4,500", 450050 → "KSh 4,500.50" */
export function formatKes(cents: Cents): string {
  const shillings = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = String(shillings).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `KSh ${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}
