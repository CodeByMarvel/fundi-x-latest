import { BillingService } from '../domain/billing/BillingService';
import { JobRepository } from '../domain/jobs/JobRepository';
import { PricingService } from '../domain/pricing/PricingService';
import { ProviderRepository } from '../domain/providers/ProviderRepository';
import { createMockBackend, PhoneResponse } from './mock/mockBackend';
import { createServerBackend } from './server/serverBackend';

export type { PhoneResponse };

/** Everything the app can ask of "the backend". The mock and the server client both provide it. */
export type Backend = {
  jobs: JobRepository;
  billing: BillingService;
  pricing: PricingService;
  providers: ProviderRepository;
  /** Dev-only: answers the M-Pesa PIN prompt a real phone would show. */
  phone: { respondToPaymentPrompt(paymentId: string, response: PhoneResponse): void };
  /** Stops background work (polling) when the backend is replaced. */
  dispose?: () => void;
};

/**
 * Which backend the app talks to, decided by how the person got in:
 *
 * - signed in → the Fundi-X server, as that account (createServerBackend)
 * - demo mode (development only) → the in-memory simulation, where p1
 *   (Brian) is played by whoever is on the mechanic side and the
 *   simulation plays the other providers
 *
 * Screens import the objects below and never know which one is behind
 * them. Each forwards to the current backend, so switching (sign-in,
 * sign-out) needs no screen changes.
 */
let mock: Backend | undefined;
let current: Backend | undefined;
let currentKey: string | undefined;
let unsubscribers: (() => void)[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

function active(): Backend {
  if (!current) {
    selectMockBackend();
  }
  return current!;
}

function activate(key: string, make: () => Backend) {
  if (currentKey === key) {
    return;
  }
  unsubscribers.forEach(u => u());
  // The simulation is kept (its data survives leaving demo mode); a
  // server client stops polling.
  if (current !== mock) {
    current?.dispose?.();
  }
  current = make();
  currentKey = key;
  unsubscribers = [current.jobs, current.billing, current.providers].map(store =>
    store.subscribe(notify),
  );
  notify();
}

export function selectMockBackend() {
  activate('mock', () => (mock ??= createMockBackend({ botProviderIds: ['p2', 'p3'] })));
}

export function selectServerBackend(token: string, role: 'customer' | 'provider') {
  activate(`server:${token}`, () => createServerBackend({ token, role }));
}

/** One subscribe for every store: fires on any change, and on switching backend. */
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * An object whose methods call the same-named method of the current
 * backend's `part`. Snapshot functions keep working across a switch.
 */
function forward<K extends 'jobs' | 'billing' | 'pricing' | 'providers'>(
  part: K,
  methods: readonly (keyof Backend[K])[],
): Backend[K] {
  const target: Record<string, unknown> = { subscribe };
  for (const name of methods) {
    target[name as string] = (...args: unknown[]) =>
      (active()[part][name] as (...a: unknown[]) => unknown)(...args);
  }
  return target as unknown as Backend[K];
}

export const jobRepository = forward('jobs', [
  'createJob',
  'cancelJob',
  'approveQuote',
  'rejectQuote',
  'confirmCompletion',
  'disputeCompletion',
  'submitRating',
  'acceptOffer',
  'declineOffer',
  'withdrawFromJob',
  'startTrip',
  'markArrived',
  'startInspection',
  'readyToStart',
  'reportCustomerNoShow',
  'sendQuote',
  'reviseQuote',
  'raiseAdditionalQuote',
  'markWorkComplete',
  'getJob',
  'getJobEvents',
  'getCustomerContact',
  'getJobSnapshot',
  'getJobsSnapshot',
  'getQuoteSnapshot',
  'getQuotesSnapshot',
]);

export const billingService = forward('billing', [
  'initiatePayment',
  'getPaymentSnapshot',
  'getChargesSnapshot',
  'getPaymentsSnapshot',
  'getRefundsSnapshot',
  'getReleasesSnapshot',
]);

export const pricingService = forward('pricing', ['estimate', 'services']);

export const providerRepository = forward('providers', [
  'setOnline',
  'reportLocation',
  'getProviderSnapshot',
  'getProvidersSnapshot',
  'getReliabilityEventsSnapshot',
]);

/**
 * Dev-only: answers the simulated M-Pesa prompt that a real phone would
 * show. With the server, it asks the server's simulator (never in
 * production); goes away once Daraja sends real prompts.
 */
export const simulatedPhone = {
  respondToPaymentPrompt: (paymentId: string, response: PhoneResponse) =>
    active().phone.respondToPaymentPrompt(paymentId, response),
};
