import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Coordinates } from '../../../src/domain/jobs/request';
import type { Provider } from '../../../src/domain/providers/types';
import { requireCustomer, requireProvider } from '../auth';
import type { Database } from '../db/client';
import { jobs, providers, releases, reliabilityEvents, users } from '../db/schema';
import { estimateEtaMinutes } from '../jobs/actions';
import { saveJob, toJob } from '../jobs/store';
import { ConflictError, NotFoundError } from '../errors';
import { cellsWithin, matchingCell, metresBetween } from '../matching/h3';
import { eligibleProviders } from '../matching/service';
import { getSetting } from '../settings';
import { toRelease } from '../payments/service';

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

/** How many mechanics the customer's home screen lists. */
const NEARBY_LIMIT = 10;

/** What the mechanic's app shows about its own availability. */
const availabilityView = (p: ProviderRow) => ({
  online: p.online,
  verification: p.verification,
  locationAt: p.locationAt?.toISOString() ?? null,
});

/**
 * A provider as the apps show them (name, rating, how far away). The
 * exact position is never sent: only the distance to the job.
 */
function providerView(
  p: ProviderRow,
  user: { name: string; phone: string | null },
  distanceKm = 0,
): Provider {
  return {
    id: p.userId,
    name: p.businessName ?? user.name,
    type: p.type,
    specialty: p.specialty,
    rating: p.ratingCount ? Math.round((p.ratingTotal / p.ratingCount) * 10) / 10 : 0,
    ratingCount: p.ratingCount,
    distanceKm: Math.round(distanceKm * 10) / 10,
    phone: user.phone ?? '',
    online: p.online,
  };
}

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

  async function withUser(id: string) {
    const [row] = await db
      .select({ provider: providers, name: users.name, phone: users.phone })
      .from(providers)
      .innerJoin(users, eq(users.id, providers.userId))
      .where(eq(providers.userId, id));
    return row;
  }

  /** The mechanic's own profile and reliability record. */
  app.get('/provider/me', async request => {
    const caller = requireProvider(request);
    const row = await withUser(caller.id);
    if (!row) {
      throw new ConflictError('provider_profile', 'Set up your mechanic profile first');
    }
    const events = await db
      .select()
      .from(reliabilityEvents)
      .where(eq(reliabilityEvents.providerId, caller.id))
      .orderBy(asc(reliabilityEvents.createdAt));
    return {
      provider: providerView(row.provider, row),
      reliability: events.map(e => ({
        id: e.id,
        providerId: e.providerId,
        jobId: e.jobId,
        type: e.type,
        at: e.createdAt.toISOString(),
      })),
    };
  });

  /** Every payout to this mechanic, oldest first. */
  app.get('/provider/releases', async request => {
    const caller = requireProvider(request);
    const rows = await db
      .select()
      .from(releases)
      .where(eq(releases.providerId, caller.id))
      .orderBy(asc(releases.createdAt));
    return rows.map(toRelease);
  });

  /**
   * The mechanic on one of the customer's jobs: who's coming, their rating,
   * how far away they are. Only for a customer that mechanic has worked
   * for; anyone else gets "not found".
   */
  app.get<{ Params: { id: string } }>(
    '/providers/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    async request => {
      const caller = requireCustomer(request);
      const [job] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.customerId, caller.id), eq(jobs.providerId, request.params.id)))
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      const row = job && (await withUser(request.params.id));
      if (!row) {
        throw new NotFoundError('Provider');
      }
      const { lat, lng } = row.provider;
      const coords = toJob(job).location.coords;
      const km = lat !== null && lng !== null && coords ? metresBetween({ lat, lng }, coords) / 1000 : 0;
      return providerView(row.provider, row, km);
    },
  );

  /**
   * Mechanics free to take a job near the customer right now, for the
   * home screen. The same area matching searches; nearest first. Distance
   * is rounded up to the half kilometre and the phone number is left out:
   * enough to choose, not enough to find someone.
   */
  app.get<{ Querystring: Coordinates }>(
    '/providers/nearby',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['lat', 'lng'],
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
          },
        },
      },
    },
    async request => {
      requireCustomer(request);
      const here = request.query;
      const ring = await getSetting(db, 'matching_max_ring');
      const rows = await eligibleProviders(db, new Date(), {
        cells: cellsWithin(matchingCell(here), ring),
        exclude: [],
      });
      const nearest = rows
        .map(r => ({ id: r.id, metres: metresBetween(here, { lat: r.lat!, lng: r.lng! }) }))
        .sort((a, b) => a.metres - b.metres)
        .slice(0, NEARBY_LIMIT);
      const found = await Promise.all(nearest.map(n => withUser(n.id)));
      return nearest.flatMap((n, i) => {
        const row = found[i];
        if (!row) {
          return [];
        }
        const km = Math.max(0.5, Math.ceil(n.metres / 500) / 2);
        return [{ ...providerView(row.provider, row, km), phone: '' }];
      });
    },
  );

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
