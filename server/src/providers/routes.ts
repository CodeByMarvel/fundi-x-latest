import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Coordinates } from '../../../src/domain/jobs/request';
import { requireProvider } from '../auth';
import type { Database } from '../db/client';
import { jobs, providers } from '../db/schema';
import { estimateEtaMinutes } from '../jobs/actions';
import { saveJob, toJob } from '../jobs/store';
import { ConflictError } from '../errors';
import { matchingCell, metresBetween } from '../matching/h3';

const coordsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['lat', 'lng'],
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
  },
} as const;

type ProviderRow = typeof providers.$inferSelect;

/** What the mechanic's app shows about its own availability. */
const availabilityView = (p: ProviderRow) => ({
  online: p.online,
  verification: p.verification,
  locationAt: p.locationAt?.toISOString() ?? null,
});

const located = (c: Coordinates, at: Date) => ({
  lat: c.lat,
  lng: c.lng,
  h3Cell: matchingCell(c),
  locationAt: at,
});

/** Where a position stops being kept: offline means we don't track you. */
const forgotten = { lat: null, lng: null, h3Cell: null, locationAt: null };

/**
 * The mechanic's side of matching: the "available" switch and position
 * reports. The server, not the app, turns positions into H3 cells.
 */
export function registerProviderRoutes(app: FastifyInstance, db: Database) {
  async function profileOf(id: string) {
    const [provider] = await db.select().from(providers).where(eq(providers.userId, id));
    if (!provider) {
      throw new ConflictError('provider_profile', 'Set up your mechanic profile first');
    }
    return provider;
  }

  /**
   * While driving to a job, each position report updates the ETA the
   * customer sees. Not an event (job-flow.md §14), and it never moves the
   * promised arrival time the late rule uses.
   */
  async function refreshEta(providerId: string, here: Coordinates) {
    await db.transaction(async tx => {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.providerId, providerId), eq(jobs.status, 'EN_ROUTE')))
        .for('update');
      const job = row && toJob(row);
      if (!job?.location.coords) {
        return;
      }
      const etaMinutes = estimateEtaMinutes(metresBetween(here, job.location.coords));
      if (etaMinutes !== job.etaMinutes) {
        await saveJob(tx, { ...job, etaMinutes, updatedAt: new Date().toISOString() });
      }
    });
  }

  async function hasJobUnderWay(providerId: string) {
    const [row] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.providerId, providerId), inArray(jobs.status, ['ACCEPTED', 'EN_ROUTE'])))
      .limit(1);
    return !!row;
  }

  app.get('/provider/availability', async request => {
    const caller = requireProvider(request);
    return availabilityView(await profileOf(caller.id));
  });

  /**
   * Going online needs a verified profile and the current position, so the
   * provider can be matched straight away. Going offline forgets where
   * they were.
   */
  app.put<{ Body: { online: boolean; location?: Coordinates } }>(
    '/provider/availability',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['online'],
          properties: { online: { type: 'boolean' }, location: coordsSchema },
        },
      },
    },
    async request => {
      const caller = requireProvider(request);
      const provider = await profileOf(caller.id);
      const { online, location } = request.body;
      const at = new Date();
      if (online) {
        if (provider.verification !== 'VERIFIED') {
          throw new ConflictError(
            'not_verified',
            'Fundi-X is still checking your profile. You can go online once it is verified.',
          );
        }
        if (!location) {
          throw new ConflictError('location_required', 'Turn on location to go online');
        }
      }
      const [saved] = await db
        .update(providers)
        .set({
          online,
          ...(online ? located(location!, at) : forgotten),
          updatedAt: at,
        })
        .where(eq(providers.userId, caller.id))
        .returning();
      return availabilityView(saved);
    },
  );

  /**
   * Sent by the app every 30 seconds or so while online or heading to a
   * job. Refused otherwise: we only keep a mechanic's position while they
   * are working.
   */
  app.put<{ Body: Coordinates }>(
    '/provider/location',
    { schema: { body: coordsSchema } },
    async request => {
      const caller = requireProvider(request);
      const provider = await profileOf(caller.id);
      // "Online" means open to new offers; a job already under way still
      // needs the position (live ETA) even if they switched that off.
      if (!provider.online && !(await hasJobUnderWay(caller.id))) {
        throw new ConflictError('offline', 'Go online to share your location');
      }
      const at = new Date();
      const [saved] = await db
        .update(providers)
        .set({ ...located(request.body, at), updatedAt: at })
        .where(eq(providers.userId, caller.id))
        .returning();
      await refreshEta(caller.id, request.body);
      return availabilityView(saved);
    },
  );
}
