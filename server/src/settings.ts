import { eq } from 'drizzle-orm';
import type { Cents } from '../../src/domain/money';
import { CALL_OUT_FEE } from '../../src/domain/pricing/engine';
import type { Database, Tx } from './db/client';
import { settings } from './db/schema';

/**
 * Every setting the business can change without a release, with the value
 * that applies until someone changes it. Adding a setting means adding a
 * line here; the type of each value comes from its default.
 */
export const SETTING_DEFAULTS = {
  /** Charged up front on every booking (docs/job-flow.md §3.1). */
  call_out_fee: CALL_OUT_FEE as Cents,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

/** The current value: the saved row if there is one, otherwise the default. */
export async function getSetting<K extends SettingKey>(
  db: Database | Tx,
  key: K,
): Promise<Settings[K]> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return row ? (row.value as Settings[K]) : SETTING_DEFAULTS[key];
}

/** Saves a new value. `by` is the admin who changed it. */
export async function setSetting<K extends SettingKey>(
  db: Database | Tx,
  key: K,
  value: Settings[K],
  by: string | null,
) {
  const at = new Date();
  await db
    .insert(settings)
    .values({ key, value, updatedBy: by, updatedAt: at })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: by, updatedAt: at },
    });
}
