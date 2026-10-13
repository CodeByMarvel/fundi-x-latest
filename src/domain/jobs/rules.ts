/**
 * Time limits decided in docs/job-flow.md. They're business rules, so they
 * live in the domain: the backend enforces them and the apps show them
 * (e.g. the no-show countdown) from the same numbers.
 */
const MINUTE = 60_000;

/** An unpaid booking is closed after this long. */
export const CALL_OUT_PAYMENT_WINDOW_MS = 30 * MINUTE;

/** How long a provider waits at the location before reporting a no-show. */
export const NO_SHOW_WAIT_MS = 15 * MINUTE;

/** The agreed price must reach escrow within this long, or the job ends. */
export const SERVICE_PAYMENT_WINDOW_MS = 30 * MINUTE;

/** After the promised arrival time, how long before the provider counts as late. */
export const LATE_GRACE_MS = 20 * MINUTE;

/**
 * How long an M-Pesa PIN prompt stays open. A deadline that falls while the
 * customer is still entering their PIN waits this long instead of cutting
 * them off mid-payment.
 */
export const STK_TIMEOUT_MS = 60_000;

/** A customer who neither confirms nor disputes is taken to confirm after this. */
export const AUTO_CONFIRM_MS = 48 * 60 * MINUTE;

/** True once a provider who's still EN_ROUTE is past arrival time + grace. */
export function isProviderLate(
  job: { status: string; expectedArrivalAt?: string },
  now: number,
) {
  return (
    job.status === 'EN_ROUTE' &&
    !!job.expectedArrivalAt &&
    now > Date.parse(job.expectedArrivalAt) + LATE_GRACE_MS
  );
}
