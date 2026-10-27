import type { Coordinates } from '../../../src/domain/jobs/request';
import { skillCovers } from '../../../src/domain/providers/skills';
import type { providers } from '../db/schema';
import { metresBetween } from '../matching/h3';

/**
 * Whether a provider has filled in profile v2. Profiles from before it are
 * asked again (nextStep) and aren't offered jobs until then.
 */
export function profileComplete(p: typeof providers.$inferSelect) {
  return (
    !!p.skills?.length &&
    p.baseLat !== null &&
    p.baseLng !== null &&
    p.travelKm !== null &&
    p.transport !== null &&
    p.experienceYears !== null
  );
}

/**
 * Whether a job may be offered to this provider: they take its category,
 * and it's within their travel limit from their base (not from where they
 * happen to be now). Matching and the customers' "nearby" list use it.
 */
export function canTakeJob(
  p: Pick<typeof providers.$inferSelect, 'skills' | 'baseLat' | 'baseLng' | 'travelKm'>,
  at: Coordinates,
  categoryId?: string,
) {
  if (!p.skills?.length || p.baseLat === null || p.baseLng === null || p.travelKm === null) {
    return false;
  }
  if (categoryId !== undefined && !skillCovers(p.skills, categoryId)) {
    return false;
  }
  return metresBetween({ lat: p.baseLat, lng: p.baseLng }, at) <= p.travelKm * 1000;
}
