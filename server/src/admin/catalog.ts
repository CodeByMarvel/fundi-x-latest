import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  type Catalog,
  type CatalogPackage,
  type ModelSpec,
  modelProblems,
  packageProblems,
  type PartsOption,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASSES,
  classify,
} from '../../../src/domain/pricing/catalog';
import { calculateEstimate } from '../../../src/domain/pricing/engine';
import { SERVICE_CODES } from '../../../src/domain/quotes/serviceCodes';
import type { Vehicle } from '../../../src/domain/jobs/request';
import { liveCatalog, saveCatalog } from '../catalog/store';
import type { Database } from '../db/client';
import { catalogVersions, staff } from '../db/schema';
import { BadRequestError, NotFoundError } from '../errors';
import { getSetting } from '../settings';
import { reasonFrom, reasonSchema } from './reason';
import { audit, staffOf } from './session';

const classPrice = {
  type: 'object',
  additionalProperties: false,
  required: ['quantity', 'unitPrice'],
  properties: {
    quantity: { type: 'integer', minimum: 1, maximum: 100 },
    unitPrice: { type: 'integer', minimum: 1, maximum: 100_000_000 },
  },
} as const;

const packageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'active', 'items'],
  properties: {
    id: { type: 'string', maxLength: 50 },
    name: { type: 'string', maxLength: 80 },
    active: { type: 'boolean' },
    items: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['serviceCode', 'kind', 'description', 'prices'],
        properties: {
          serviceCode: { type: 'string', maxLength: 64 },
          kind: { enum: ['PART', 'LABOUR', 'CONSUMABLE', 'OTHER'] },
          description: { type: 'string', maxLength: 200 },
          prices: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(VEHICLE_CLASSES.map(c => [c, classPrice])),
          },
        },
      },
    },
  },
} as const;

const modelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['make', 'model', 'engineCc', 'fuel'],
  properties: {
    make: { type: 'string', maxLength: 60 },
    model: { type: 'string', maxLength: 60 },
    engineCc: { type: 'integer' },
    fuel: { enum: ['petrol', 'diesel', 'hybrid', 'electric'] },
  },
} as const;

/** Every change names the version it was made from (see saveCatalog). */
const baseVersion = { type: ['string', 'null'], maxLength: 100 } as const;

const change = (properties: Record<string, unknown>, required: string[]) => ({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['baseVersionId', 'reason', ...required],
    properties: { baseVersionId: baseVersion, reason: reasonSchema, ...properties },
  },
});

/**
 * Configuration → Catalog (docs/admin-portal.md §3.5): the fixed prices
 * for maintenance. Each save is a new catalog version; jobs already booked
 * keep the price in their quote.
 */
export function registerAdminCatalog(admin: FastifyInstance, db: Database) {
  admin.get('/catalog', async request => {
    await staffOf(db, request, 'catalog.edit');
    const live = await liveCatalog(db);
    const history = await db
      .select({
        id: catalogVersions.id,
        summary: catalogVersions.summary,
        reason: catalogVersions.reason,
        createdAt: catalogVersions.createdAt,
        staffEmail: staff.email,
      })
      .from(catalogVersions)
      .leftJoin(staff, eq(staff.id, catalogVersions.createdBy))
      .orderBy(desc(catalogVersions.createdAt))
      .limit(30);
    return {
      ...live,
      history,
      classes: VEHICLE_CLASSES.map(id => ({ id, label: VEHICLE_CLASS_LABELS[id] })),
      serviceCodes: SERVICE_CODES,
    };
  });

  /** Saves a whole catalog as the new version, with an audit entry. */
  async function save(
    request: FastifyRequest,
    staffId: string,
    catalog: Catalog,
    change: { baseVersionId: string | null; summary: string; reason: string; target: string },
  ) {
    return db.transaction(async tx => {
      const saved = await saveCatalog(tx, catalog, { ...change, staffId });
      await audit(tx, request, {
        staffId,
        action: 'catalog.update',
        targetType: 'catalog',
        targetId: change.target,
        after: { versionId: saved.versionId, summary: change.summary },
        reason: change.reason,
      });
      return { versionId: saved.versionId, catalog };
    });
  }

  /** Adds a package, or replaces the one with the same id. */
  admin.put<{
    Params: { id: string };
    Body: { baseVersionId: string | null; reason: string; package: CatalogPackage };
  }>(
    '/catalog/packages/:id',
    { schema: change({ package: packageSchema }, ['package']) },
    async request => {
      const me = await staffOf(db, request, 'catalog.edit');
      const reason = reasonFrom(request.body.reason);
      const pkg: CatalogPackage = {
        ...request.body.package,
        name: request.body.package.name.trim(),
        items: request.body.package.items.map(i => ({ ...i, description: i.description.trim() })),
      };
      if (pkg.id !== request.params.id) {
        throw new BadRequestError('The package id in the address and the body differ');
      }
      const problems = packageProblems(pkg);
      if (problems.length) {
        throw new BadRequestError(problems.join(' '));
      }
      const { catalog } = await liveCatalog(db);
      const exists = catalog.packages.some(p => p.id === pkg.id);
      const next: Catalog = {
        ...catalog,
        packages: exists
          ? catalog.packages.map(p => (p.id === pkg.id ? pkg : p))
          : [...catalog.packages, pkg],
      };
      return save(request, me.id, next, {
        baseVersionId: request.body.baseVersionId,
        summary: `${pkg.name}: ${exists ? 'updated' : 'added'}${pkg.active ? '' : ' (inactive)'}`,
        reason,
        target: pkg.id,
      });
    },
  );

  admin.put<{
    Body: { baseVersionId: string | null; reason: string; models: ModelSpec[] };
  }>(
    '/catalog/models',
    { schema: change({ models: { type: 'array', maxItems: 2000, items: modelSchema } }, ['models']) },
    async request => {
      const me = await staffOf(db, request, 'catalog.edit');
      const reason = reasonFrom(request.body.reason);
      const models = request.body.models.map(m => ({
        ...m,
        make: m.make.trim(),
        model: m.model.trim(),
      }));
      const problems = modelProblems(models);
      if (problems.length) {
        throw new BadRequestError(problems.slice(0, 5).join(' '));
      }
      const { catalog } = await liveCatalog(db);
      return save(request, me.id, { ...catalog, models }, {
        baseVersionId: request.body.baseVersionId,
        summary: `Vehicle models: ${models.length} listed`,
        reason,
        target: 'models',
      });
    },
  );

  admin.put<{
    Body: { baseVersionId: string | null; reason: string; premiumMakes: string[] };
  }>(
    '/catalog/premium-makes',
    {
      schema: change(
        { premiumMakes: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 60 } } },
        ['premiumMakes'],
      ),
    },
    async request => {
      const me = await staffOf(db, request, 'catalog.edit');
      const reason = reasonFrom(request.body.reason);
      const premiumMakes = [
        ...new Set(request.body.premiumMakes.map(m => m.trim().toLowerCase()).filter(Boolean)),
      ];
      const { catalog } = await liveCatalog(db);
      return save(request, me.id, { ...catalog, premiumMakes }, {
        baseVersionId: request.body.baseVersionId,
        summary: `Premium makes: ${premiumMakes.join(', ') || 'none'}`,
        reason,
        target: 'premium_makes',
      });
    },
  );

  /** Makes an old version live again (saved as a new version). */
  admin.post<{
    Params: { versionId: string };
    Body: { baseVersionId: string | null; reason: string };
  }>('/catalog/versions/:versionId/restore', { schema: change({}, []) }, async request => {
    const me = await staffOf(db, request, 'catalog.edit');
    const reason = reasonFrom(request.body.reason);
    const [old] = await db
      .select()
      .from(catalogVersions)
      .where(eq(catalogVersions.id, request.params.versionId));
    if (!old) {
      throw new NotFoundError('Catalog version');
    }
    return save(request, me.id, old.catalog, {
      baseVersionId: request.body.baseVersionId,
      summary: `Restored the version of ${old.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`,
      reason,
      target: old.id,
    });
  });

  /** What a vehicle would pay for a package now, as the customer sees it. */
  admin.post<{
    Body: { categoryId: string; vehicle: Omit<Vehicle, 'id' | 'registration'>; partsOption?: PartsOption };
  }>(
    '/catalog/preview',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['categoryId', 'vehicle'],
          properties: {
            categoryId: { type: 'string', maxLength: 64 },
            partsOption: { enum: ['MECHANIC', 'OWN'] },
            vehicle: {
              type: 'object',
              additionalProperties: false,
              required: ['make', 'model'],
              properties: {
                make: { type: 'string', maxLength: 60 },
                model: { type: 'string', maxLength: 60 },
                year: { type: 'integer' },
                engineCc: { type: 'integer', minimum: 50, maximum: 10000 },
                fuel: { enum: ['petrol', 'diesel', 'hybrid', 'electric'] },
              },
            },
          },
        },
      },
    },
    async request => {
      await staffOf(db, request, 'catalog.edit');
      const { catalog } = await liveCatalog(db);
      const vehicle: Vehicle = { id: 'preview', registration: '', ...request.body.vehicle };
      const estimate = calculateEstimate(
        {
          requestType: 'service',
          categoryId: request.body.categoryId,
          vehicle,
          answers: {},
          description: '',
          drivability: 'safe',
          location: { kind: 'home', label: 'Preview', address: '' },
          urgency: 'now',
          ...(request.body.partsOption && { partsOption: request.body.partsOption }),
        },
        await getSetting(db, 'call_out_fee'),
        catalog,
      );
      return { ...estimate, classification: classify(catalog, vehicle) };
    },
  );
}
