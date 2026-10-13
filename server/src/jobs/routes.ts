import type { FastifyInstance } from 'fastify';
import type {
  CreateJobInput,
  JobRequestDetails,
} from '../../../src/domain/jobs/types';
import { calculateEstimate } from '../../../src/domain/pricing/engine';
import { callerOf, requireCustomer } from '../auth';
import type { Database } from '../db/client';
import { getSetting } from '../settings';
import { createJobSchema, jobIdParams, requestDetailsSchema } from './schemas';
import { cancelJob, createJob, getJob, getJobEvents } from './service';

type JobParams = { Params: { id: string } };

/**
 * HTTP endpoints. Each one only translates: read the request, call the
 * service, return its result. Rules live in the service and the domain,
 * so the same rule can never behave differently on two endpoints.
 */
export function registerJobRoutes(app: FastifyInstance, db: Database) {
  /** The price shown on the review screen before booking. */
  app.post<{ Body: JobRequestDetails }>(
    '/pricing/estimate',
    { schema: { body: requestDetailsSchema } },
    async request => {
      requireCustomer(request);
      return calculateEstimate(
        request.body,
        await getSetting(db, 'call_out_fee'),
      );
    },
  );

  app.post<{ Body: CreateJobInput }>(
    '/jobs',
    { schema: { body: createJobSchema } },
    async (request, reply) => {
      const job = await createJob(db, requireCustomer(request), request.body);
      return reply.status(201).send(job);
    },
  );

  app.get<JobParams>(
    '/jobs/:id',
    { schema: { params: jobIdParams } },
    async request => getJob(db, callerOf(request), request.params.id),
  );

  app.get<JobParams>(
    '/jobs/:id/events',
    { schema: { params: jobIdParams } },
    async request => getJobEvents(db, callerOf(request), request.params.id),
  );

  app.post<JobParams>(
    '/jobs/:id/cancel',
    { schema: { params: jobIdParams } },
    async request => cancelJob(db, callerOf(request), request.params.id),
  );
}
