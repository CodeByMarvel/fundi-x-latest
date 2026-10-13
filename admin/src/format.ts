/** Money arrives in cents, like everywhere else in Fundi-X. */
export const ksh = (cents: number) =>
  `KSh ${(cents / 100).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

const dateTime = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Always Nairobi time, whatever the computer's clock is set to. */
export const when = (iso: string) => dateTime.format(new Date(iso));

/** What each setting is, for people. Keys match server/src/settings.ts. */
export const SETTINGS: Record<
  string,
  { label: string; help: string; kind: 'money' }
> = {
  call_out_fee: {
    label: 'Call-out fee',
    help: 'Charged up front on every booking: transport and inspection. Changes apply to new quotes straight away; customers holding an old quote are shown the new price before they book.',
    kind: 'money',
  },
};

/** A setting value as people read it. */
export function settingValue(key: string | null, value: unknown) {
  if (key && SETTINGS[key]?.kind === 'money' && typeof value === 'number') {
    return ksh(value);
  }
  return value === null || value === undefined ? '—' : JSON.stringify(value);
}

/** Audit actions as people read them. */
export const ACTIONS: Record<string, string> = {
  'staff.owner_created': 'Owner account created',
  'staff.sign_in': 'Signed in',
  'staff.sign_in_denied': 'Sign-in refused',
  'staff.sign_out': 'Signed out',
  'settings.update': 'Setting changed',
};

/** Audit actions worth a second look. */
export const isWarning = (action: string) => action.endsWith('_denied');
