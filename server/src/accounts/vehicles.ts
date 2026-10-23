import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Fuel, normaliseRegistration, type Vehicle } from '../../../src/domain/jobs/request';
import { requireCustomer } from '../auth';
import type { Database, Tx } from '../db/client';
import { vehicles } from '../db/schema';
import { ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import { requestDetailsProperties } from '../jobs/schemas';

type VehicleRow = typeof vehicles.$inferSelect;
type VehicleInput = Omit<Vehicle, 'id'>;

/** A vehicle as the app gets it: the same shape a booking carries. */
const toVehicle = (row: VehicleRow): Vehicle => ({
  id: row.id,
  registration: row.registration,
  make: row.make,
  model: row.model,
  ...(row.year !== null && { year: row.year }),
  ...(row.engineCc !== null && { engineCc: row.engineCc }),
  ...(row.fuel !== null && { fuel: row.fuel }),
});

export { normaliseRegistration };

const { id: _id, ...fields } = requestDetailsProperties.vehicle.properties;
const vehicleBody = {
  type: 'object',
  additionalProperties: false,
  required: ['registration', 'make', 'model'],
  properties: fields,
} as const;
const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

/** Part of deleting an account: the vehicles go with it. */
export async function forgetVehicles(tx: Database | Tx, userId: string, at: Date) {
  await tx
    .update(vehicles)
    .set({ removedAt: at, updatedAt: at })
    .where(and(eq(vehicles.userId, userId), isNull(vehicles.removedAt)));
}

/**
 * "My vehicles": the cars a customer books for. A booking still sends the
 * full vehicle with the job, so the job keeps the details it was priced on.
 */
export function registerVehicleRoutes(app: FastifyInstance, db: Database) {
  const columns = (input: VehicleInput) => {
    const plate = normaliseRegistration(input.registration);
    if (!plate.registrationKey) {
      throw new ConflictError('invalid_registration', 'Enter the registration number');
    }
    return {
      ...plate,
      make: input.make.trim(),
      model: input.model.trim(),
      year: input.year ?? null,
      engineCc: input.engineCc ?? null,
      fuel: (input.fuel ?? null) as Fuel | null,
    };
  };

  /** The other saved car with this plate, which would make a duplicate. */
  async function sameCar(userId: string, registrationKey: string, except?: string) {
    const [row] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.userId, userId),
          eq(vehicles.registrationKey, registrationKey),
          isNull(vehicles.removedAt),
        ),
      );
    return row && row.id !== except ? row : undefined;
  }

  const duplicate = (registration: string) =>
    new ConflictError('vehicle_exists', `${registration} is already in your vehicles`);

  async function mine(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.userId, userId), isNull(vehicles.removedAt)));
    if (!row) {
      throw new NotFoundError('Vehicle');
    }
    return row;
  }

  app.get('/me/vehicles', async request => {
    const caller = requireCustomer(request);
    const rows = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.userId, caller.id), isNull(vehicles.removedAt)))
      .orderBy(desc(vehicles.createdAt));
    return rows.map(toVehicle);
  });

  app.post<{ Body: VehicleInput }>(
    '/me/vehicles',
    { schema: { body: vehicleBody } },
    async (request, reply) => {
      const caller = requireCustomer(request);
      const values = columns(request.body);
      if (await sameCar(caller.id, values.registrationKey)) {
        throw duplicate(values.registration);
      }
      const at = new Date();
      // Two adds at once: the unique index refuses the second.
      const [saved] = await db
        .insert(vehicles)
        .values({ id: newId('veh'), userId: caller.id, ...values, createdAt: at, updatedAt: at })
        .onConflictDoNothing()
        .returning();
      if (!saved) {
        throw duplicate(values.registration);
      }
      reply.code(201);
      return toVehicle(saved);
    },
  );

  app.put<{ Params: { id: string }; Body: VehicleInput }>(
    '/me/vehicles/:id',
    { schema: { params: idParams, body: vehicleBody } },
    async request => {
      const caller = requireCustomer(request);
      await mine(caller.id, request.params.id);
      const values = columns(request.body);
      if (await sameCar(caller.id, values.registrationKey, request.params.id)) {
        throw duplicate(values.registration);
      }
      const [saved] = await db
        .update(vehicles)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(vehicles.id, request.params.id))
        .returning();
      return toVehicle(saved);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/me/vehicles/:id',
    { schema: { params: idParams } },
    async request => {
      const caller = requireCustomer(request);
      await mine(caller.id, request.params.id);
      const at = new Date();
      await db
        .update(vehicles)
        .set({ removedAt: at, updatedAt: at })
        .where(eq(vehicles.id, request.params.id));
      return { ok: true };
    },
  );
}
