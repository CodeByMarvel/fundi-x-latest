import { JobRepository } from '../domain/jobs/JobRepository';
import { createMockJobRepository } from './mock/MockJobRepository';

/**
 * The one jobs backend the whole app talks to. Swapping the mock for a real
 * API client happens here and nowhere else.
 */
export const jobRepository: JobRepository = createMockJobRepository();
