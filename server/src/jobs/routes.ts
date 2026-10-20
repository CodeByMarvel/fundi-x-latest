import type { FastifyInstance } from 'fastify';
import type {
  CreateJobInput,
  JobRequestDetails,
} from '../../../src/domain/jobs/types';
import { calculateEstimate } from '../../../src/domain/pricing/engine';
import { callerOf, requireCustomer } from '../auth';
import type { Database } from '../db/client';
import { liveCatalog } from '../catalog/store';
import { getSetting } from '../settings';
import type { QuoteItemInput } from '../../../src/domain/quotes/types';
import * as act from './actions';
import {
  additionalQuoteSchema,
  createJobSchema,
  disputeSchema,
  jobIdParams,
  noteSchema,
  quoteAnswerSchema,
  ratingSchema,
  requestDetailsSchema,
  sendQuoteSchema,
  summarySchema,
} from './schemas';
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
        (await liveCatalog(db)).catalog,
      );
    },
  );

  /** The fixed-price services on offer, for the app's service list. */
  app.get('/pricing/services', async request => {
    requireCustomer(request);
    const { catalog } = await liveCatalog(db);
    return catalog.packages.filter(p => p.active).map(p => ({ id: p.id, name: p.name }));
  });

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

  /** A customer's bookings, or a provider's offers and jobs; newest first. */
  app.get('/jobs', async request => act.listJobs(db, callerOf(request)));

  app.get<JobParams>(
    '/jobs/:id/quotes',
    { schema: { params: jobIdParams } },
    async request => act.listQuotes(db, callerOf(request), request.params.id),
  );

  /** The customer's name and number, for the mechanic on an active job. */
  app.get<JobParams>(
    '/jobs/:id/contact',
    { schema: { params: jobIdParams } },
    async request => act.jobContact(db, callerOf(request), request.params.id),
  );

  // ---- Actions: POST /jobs/:id/<action>. Who may do what is checked in
  // actions.ts; the body schemas only shape the input.
  type Body<B> = JobParams & { Body: B };
  const action = <B = Record<string, never>>(
    name: string,
    run: (caller: ReturnType<typeof callerOf>, id: string, body: B) => Promise<unknown>,
    bodySchema?: object,
  ) =>
    app.post<Body<B>>(
      `/jobs/:id/${name}`,
      {
        schema: { params: jobIdParams, ...(bodySchema && { body: bodySchema }) },
        // "Complete" or "withdraw" with nothing to add may send no body at all.
        preValidation: async request => {
          request.body ??= {} as B;
        },
      },
      async request => run(callerOf(request), request.params.id, request.body as B),
    );

  // Provider
  action('accept', (c, id) => act.acceptOffer(db, c, id));
  action('decline', (c, id) => act.declineOffer(db, c, id));
  action<{ note?: string }>('withdraw', (c, id, b) => act.withdraw(db, c, id, b.note ?? ''), noteSchema);
  action('start-trip', (c, id) => act.startTrip(db, c, id));
  action('arrived', (c, id) => act.markArrived(db, c, id));
  action('start-inspection', (c, id) => act.startInspection(db, c, id));
  action('ready-to-start', (c, id) => act.readyToStart(db, c, id));
  action('no-show', (c, id) => act.reportNoShow(db, c, id));
  action<{ items: QuoteItemInput[]; note?: string }>(
    'quote',
    (c, id, b) => act.sendQuote(db, c, id, b.items, b.note),
    sendQuoteSchema,
  );
  action('revise-quote', (c, id) => act.reviseQuote(db, c, id));
  action<{ items: QuoteItemInput[]; reason: string }>(
    'additional-quote',
    (c, id, b) => act.raiseAdditionalQuote(db, c, id, b.items, b.reason),
    additionalQuoteSchema,
  );
  action<{ summary?: string }>(
    'complete',
    (c, id, b) => act.markWorkComplete(db, c, id, b.summary ?? ''),
    summarySchema,
  );

  // Customer
  action<{ quoteId: string }>('approve-quote', (c, id, b) => act.approveQuote(db, c, id, b.quoteId), quoteAnswerSchema);
  action<{ quoteId: string }>('reject-quote', (c, id, b) => act.rejectQuote(db, c, id, b.quoteId), quoteAnswerSchema);
  action('confirm', (c, id) => act.confirmCompletion(db, c, id));
  action<{ reason: string }>('dispute', (c, id, b) => act.disputeCompletion(db, c, id, b.reason), disputeSchema);
  action<{ stars: number; comment?: string }>(
    'rate',
    (c, id, b) => act.rateJob(db, c, id, b.stars, b.comment ?? ''),
    ratingSchema,
  );
}
