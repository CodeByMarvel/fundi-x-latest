import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Coordinates } from '../../../src/domain/jobs/request';
import { requireCustomer } from '../auth';
import type { Database, Tx } from '../db/client';
import { savedPlaces } from '../db/schema';
import { NotFoundError } from '../errors';

export type PlaceKind = 'home' | 'work';

/** A saved place as the app gets it. */
export type SavedPlace = {
  kind: PlaceKind;
  address: string;
  coords: Coordinates;
  updatedAt: string;
};

const toPlace = (row: typeof savedPlaces.$inferSelect): SavedPlace => ({
  kind: row.kind,
  address: row.address,
  coords: { lat: row.lat, lng: row.lng },
  updatedAt: row.updatedAt.toISOString(),
});

const kindParams = {
  type: 'object',
  required: ['kind'],
  properties: { kind: { enum: ['home', 'work'] } },
} as const;

/** Part of deleting an account: saved places are personal data. */
export async function forgetPlaces(tx: Database | Tx, userId: string) {
  await tx.delete(savedPlaces).where(eq(savedPlaces.userId, userId));
}

/**
 * The customer's saved places, offered first when booking. The position
 * comes from the phone's GPS when the customer saves it ("save where I am
 * now as Home"); the address is their own words for the mechanic.
 */
export function registerPlaceRoutes(app: FastifyInstance, db: Database) {
  app.get('/me/places', async request => {
    const caller = requireCustomer(request);
    const rows = await db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, caller.id))
      .orderBy(asc(savedPlaces.kind));
    return rows.map(toPlace);
  });

  app.put<{ Params: { kind: PlaceKind }; Body: { address: string; coords: Coordinates } }>(
    '/me/places/:kind',
    {
      schema: {
        params: kindParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['address', 'coords'],
          properties: {
            address: { type: 'string', minLength: 1, maxLength: 200 },
            coords: {
              type: 'object',
              additionalProperties: false,
              required: ['lat', 'lng'],
              properties: {
                lat: { type: 'number', minimum: -90, maximum: 90 },
                lng: { type: 'number', minimum: -180, maximum: 180 },
              },
            },
          },
        },
      },
    },
    async request => {
      const caller = requireCustomer(request);
      const { address, coords } = request.body;
      const values = {
        address: address.trim(),
        lat: coords.lat,
        lng: coords.lng,
        updatedAt: new Date(),
      };
      const [saved] = await db
        .insert(savedPlaces)
        .values({ userId: caller.id, kind: request.params.kind, ...values })
        .onConflictDoUpdate({ target: [savedPlaces.userId, savedPlaces.kind], set: values })
        .returning();
      return toPlace(saved);
    },
  );

  app.delete<{ Params: { kind: PlaceKind } }>(
    '/me/places/:kind',
    { schema: { params: kindParams } },
    async request => {
      const caller = requireCustomer(request);
      const removed = await db
        .delete(savedPlaces)
        .where(and(eq(savedPlaces.userId, caller.id), eq(savedPlaces.kind, request.params.kind)))
        .returning();
      if (removed.length === 0) {
        throw new NotFoundError('Place');
      }
      return { ok: true };
    },
  );
}
