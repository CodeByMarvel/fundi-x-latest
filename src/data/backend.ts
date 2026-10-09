import { BillingService } from '../domain/billing/BillingService';
import { JobRepository } from '../domain/jobs/JobRepository';
import { PricingService } from '../domain/pricing/PricingService';
import { ProviderRepository } from '../domain/providers/ProviderRepository';
import { createMockBackend } from './mock/mockBackend';

/**
 * The backend the whole app talks to. Swapping the mock for real API
 * clients happens here and nowhere else.
 *
 * p1 (Brian) is played by whoever is on the mechanic side; the simulation
 * plays the other providers.
 */
const backend = createMockBackend({ botProviderIds: ['p2', 'p3'] });

export const jobRepository: JobRepository = backend.jobs;
export const billingService: BillingService = backend.billing;
export const pricingService: PricingService = backend.pricing;
export const providerRepository: ProviderRepository = backend.providers;

/**
 * Dev-only: answers the simulated M-Pesa prompt that a real phone would
 * show. Goes away with the mock.
 */
export const simulatedPhone = backend.phone;
