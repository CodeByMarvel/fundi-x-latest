import { desc, sql } from 'drizzle-orm';
import { type Catalog, DEFAULT_CATALOG } from '../../../src/domain/pricing/catalog';
import type { Database, Tx } from '../db/client';
import { catalogVersions } from '../db/schema';
import { ConflictError } from '../errors';
import { newId } from '../ids';

/** The live catalog and its version id (null: the starting catalog). */
export type LiveCatalog = { versionId: string | null; catalog: Catalog };

export async function liveCatalog(db: Database | Tx): Promise<LiveCatalog> {
  const [row] = await db
    .select({ id: catalogVersions.id, catalog: catalogVersions.catalog })
    .from(catalogVersions)
    .orderBy(desc(catalogVersions.createdAt))
    .limit(1);
  return row
    ? { versionId: row.id, catalog: row.catalog }
    : { versionId: null, catalog: DEFAULT_CATALOG };
}

/**
 * Saves a new version. `baseVersionId` is the version the editor started
 * from: if someone saved in between, the save is refused rather than
 * silently undoing their change. The table lock makes check-then-insert
 * safe when two staff press Save at the same moment.
 */
export async function saveCatalog(
  tx: Tx,
  catalog: Catalog,
  change: {
    baseVersionId: string | null;
    summary: string;
    reason: string;
    staffId: string;
  },
) {
  await tx.execute(sql`LOCK TABLE catalog_versions IN EXCLUSIVE MODE`);
  const current = await liveCatalog(tx);
  if (current.versionId !== change.baseVersionId) {
    throw new ConflictError(
      'catalog_changed',
      'Someone else changed the catalog since you opened it. Reload and try again.',
    );
  }
  const at = new Date();
  const id = newId('cat');
  await tx.insert(catalogVersions).values({
    id,
    catalog,
    summary: change.summary,
    reason: change.reason,
    createdBy: change.staffId,
    createdAt: at,
  });
  return { versionId: id, before: current.catalog };
}
