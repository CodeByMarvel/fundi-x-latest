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
  /**
   * How far matching may look, in H3 rings around the job's cell
   * (docs/job-flow.md §4). Ring 5 ≈ 4.5–5 km. Keeps the flat call-out
   * fair: nobody further than this is ever sent.
   */
  matching_max_ring: 5,
  /** Seconds between matching rounds; each round looks one ring further. */
  matching_round_seconds: 10,
  /** How long a provider has to accept or decline an offer. */
  offer_timeout_seconds: 45,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

export const isSettingKey = (key: string): key is SettingKey =>
  Object.hasOwn(SETTING_DEFAULTS, key);

const wholeBetween = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * What counts as a sensible value for each setting, checked before an
 * admin change is saved. Returns the problem, or null if it's fine.
 */
const RULES: { [K in SettingKey]: (value: unknown) => string | null } = {
  call_out_fee: value =>
    Number.isInteger(value) &&
    (value as number) >= 10_000 && // KSh 100
    (value as number) <= 1_000_000 && // KSh 10,000
    (value as number) % 100 === 0
      ? null
      : 'Call-out fee must be whole shillings between KSh 100 and KSh 10,000 (in cents)',
  matching_max_ring: value =>
    wholeBetween(value, 1, 10) ? null : 'Max ring must be a whole number from 1 to 10',
  matching_round_seconds: value =>
    wholeBetween(value, 3, 120)
      ? null
      : 'Matching round must be a whole number of seconds from 3 to 120',
  offer_timeout_seconds: value =>
    wholeBetween(value, 15, 300)
      ? null
      : 'Offer time must be a whole number of seconds from 15 to 300',
};

export const settingProblem = (key: SettingKey, value: unknown) =>
  RULES[key](value);

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
