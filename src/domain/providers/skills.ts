/**
 * What a mechanic says they can do (docs/mechanic-onboarding.md, "Profile").
 * Skills are the job categories customers book (the same ids as
 * src/customer/request/data/categories.ts), so matching can compare them
 * directly. "Something else", "Other service" and packages added in the
 * admin portal later aren't skills: those jobs go to any mechanic.
 */
export const SKILLS = [
  { id: 'engine', label: 'Engine & performance', group: 'repair' },
  { id: 'electrical', label: 'Electrical', group: 'repair' },
  { id: 'brakes', label: 'Brakes', group: 'repair' },
  { id: 'suspension', label: 'Suspension & steering', group: 'repair' },
  { id: 'transmission', label: 'Transmission', group: 'repair' },
  { id: 'ac', label: 'Air conditioning', group: 'repair' },
  { id: 'diagnostics', label: 'Diagnostics', group: 'repair' },
  { id: 'body', label: 'Body / accident', group: 'repair' },
  { id: 'routine_service', label: 'Routine service', group: 'service' },
  { id: 'oil_service', label: 'Oil & filter change', group: 'service' },
  { id: 'brake_service', label: 'Brake service', group: 'service' },
  { id: 'ac_service', label: 'AC service', group: 'service' },
  { id: 'inspection', label: 'Inspection', group: 'service' },
  { id: 'pre_trip', label: 'Pre-trip check', group: 'service' },
] as const;

export type SkillId = (typeof SKILLS)[number]['id'];

export const SKILL_IDS: readonly string[] = SKILLS.map(s => s.id);

/** How mechanics get around. */
export const TRANSPORTS = [
  { id: 'motorbike', label: 'Motorbike' },
  { id: 'car', label: 'Car' },
  { id: 'public_transport', label: 'Public transport' },
  { id: 'on_foot', label: 'On foot' },
] as const;

export type Transport = (typeof TRANSPORTS)[number]['id'];

/** The travel limits a mechanic picks from, in km. */
export const TRAVEL_LIMITS_KM = [3, 5, 10, 15, 25] as const;

/** Whether a mechanic with these skills can be offered a job in this category. */
export function skillCovers(skills: readonly string[], categoryId: string) {
  return !SKILL_IDS.includes(categoryId) || skills.includes(categoryId);
}

/**
 * The short line customers see under a mechanic's name, built from their
 * skills: "Brakes, Electrical +3".
 */
export function skillsSummary(skills: readonly string[]) {
  const labels = SKILLS.filter(s => skills.includes(s.id)).map(s => s.label);
  if (labels.length <= 2) {
    return labels.join(', ');
  }
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
}
