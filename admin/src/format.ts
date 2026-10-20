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
  | { label: string; help: string; kind: 'money' }
  /** Stored in basis points (2000 = 20%), edited as a percentage. */
  | { label: string; help: string; kind: 'percent' }
  | { label: string; help: string; kind: 'number'; unit: string; min: number; max: number }
> = {
  call_out_fee: {
    label: 'Call-out fee',
    help: 'Charged up front on every booking: transport and inspection. Changes apply to new quotes straight away; customers holding an old quote are shown the new price before they book.',
    kind: 'money',
  },
  matching_max_ring: {
    label: 'Matching distance',
    help: 'How far to look for a mechanic, in H3 rings around the customer (each ring is about 0.9 km; 5 ≈ 4.5–5 km). Nobody further away is ever sent, which keeps the flat call-out fee fair. Lower it if mechanics arrive late; raise it where mechanics are scarce.',
    kind: 'number',
    unit: 'rings',
    min: 1,
    max: 10,
  },
  matching_round_seconds: {
    label: 'Search widening',
    help: 'Seconds between matching rounds. Each round looks one ring further, so nearer mechanics get the first chance.',
    kind: 'number',
    unit: 'seconds',
    min: 3,
    max: 120,
  },
  offer_timeout_seconds: {
    label: 'Offer time',
    help: 'How long a mechanic has to accept or decline a job before it goes to the next one. Applies to new offers.',
    kind: 'number',
    unit: 'seconds',
    min: 15,
    max: 300,
  },
  commission_call_out_bps: {
    label: 'Commission on call-outs',
    help: "Fundi-X's share of the call-out fee, taken when it's paid out to the mechanic.",
    kind: 'percent',
  },
  commission_service_bps: {
    label: 'Commission on labour',
    help: "Fundi-X's share of the work: fixed-price labour and quoted repairs. Taken when the customer confirms the job.",
    kind: 'percent',
  },
  commission_parts_bps: {
    label: 'Commission on parts',
    help: 'Handling fee on parts the mechanic buys for the customer on fixed-price services. Taken when the parts money is paid out, before work starts. Catalog part prices should include it so the mechanic is never short.',
    kind: 'percent',
  },
};

/** 2000 basis points → "20%" */
export const percent = (bps: number) => `${bps / 100}%`;

/** A setting value as people read it. */
export function settingValue(key: string | null, value: unknown) {
  const meta = key ? SETTINGS[key] : undefined;
  if (meta?.kind === 'money' && typeof value === 'number') {
    return ksh(value);
  }
  if (meta?.kind === 'percent' && typeof value === 'number') {
    return percent(value);
  }
  if (meta?.kind === 'number' && typeof value === 'number') {
    return `${value} ${meta.unit}`;
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
  'catalog.update': 'Catalog changed',
  'dispute.resolve': 'Dispute resolved',
  'job.cancel': 'Job cancelled by support',
  'job.reassign': 'Job reassigned',
  'note.add': 'Note added',
  'user.suspend': 'Account suspended',
  'user.unsuspend': 'Suspension lifted',
  'mechanic.verify': 'Mechanic verified',
  'mechanic.reject': 'Mechanic rejected',
  'transfer.retry': 'M-Pesa transfer sent again',
  'transfer.mark_sent': 'M-Pesa transfer recorded as received',
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
