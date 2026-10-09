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

/** A customer who neither confirms nor disputes is taken to confirm after this. */
export const AUTO_CONFIRM_MS = 48 * 60 * MINUTE;
