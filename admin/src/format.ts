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
  'timer.retry': 'Timer retried',
  'incident.resolve': 'Incident resolved',
};

/** Audit actions worth a second look. */
export const isWarning = (action: string) => action.endsWith('_denied');

/** "3 min ago", for things that change often. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) {
    return 'just now';
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min ago`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)} h ago`;
  }
  return when(iso);
}

/** Long ids shortened for tables: job_1a2b3c4d… (the full id is in the link). */
export const shortId = (id: string) => {
  const cut = id.indexOf('_');
  return cut > 0 ? `${id.slice(0, cut + 9)}…` : id;
};

/** oil_service → Oil service */
export const humanize = (text: string) => {
  const t = text.replace(/[_.]/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const duration = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
