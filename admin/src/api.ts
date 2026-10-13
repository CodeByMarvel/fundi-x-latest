/**
 * Talks to the server's /admin API. The session lives in an httpOnly
 * cookie the browser sends by itself; this code never sees or stores it.
 */

/** Empty in development (Vite passes requests on); set for production. */
const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's stable code, e.g. "forbidden", "invalid_request". */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the session has ended, so the app can show sign-in again. */
export const SIGNED_OUT_EVENT = 'fundix:signed-out';

async function request<T>(url: string, method = 'GET', body?: unknown) {
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}`, {
      method,
      credentials: 'include',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new ApiError(0, 'unreachable', "Can't reach the Fundi-X server.");
  }
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? 'unknown',
      data?.message ?? `Request failed (${res.status})`,
    );
  }
  return data as T;
}

/** An /admin call. A 401 means the session ended: everyone is told. */
export async function api<T>(path: string, method = 'GET', body?: unknown) {
  try {
    return await request<T>(`/admin${path}`, method, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && path !== '/me') {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw err;
  }
}

export const serverHealth = () =>
  request<{ ok: boolean }>('/health').then(
    r => r.ok,
    () => false,
  );

export type Permission =
  | 'jobs.view'
  | 'jobs.cancel'
  | 'money.view'
  | 'money.refund'
  | 'users.view'
  | 'users.suspend'
  | 'providers.verify'
  | 'settings.edit'
  | 'logs.view'
  | 'incidents.resolve'
  | 'timers.retry'
  | 'staff.manage';

export type Me = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: Permission[];
};

export type SettingRow = {
  key: string;
  value: unknown;
  default: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AuditEntry = {
  id: string;
  staffId: string | null;
  staffEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
};

export type JobStatus =
  | 'CALL_OUT_PAYMENT_PENDING'
  | 'SEARCHING'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'DIAGNOSING'
  | 'QUOTE_SENT'
  | 'SERVICE_PAYMENT_PENDING'
  | 'IN_PROGRESS'
  | 'AWAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED';

type Vehicle = { make: string; model: string; registration: string; year?: number };

export type JobRequest = {
  requestType: 'repair' | 'service';
  categoryId: string;
  vehicle: Vehicle;
  description: string;
  drivability: string;
  urgency: string;
  location: { label: string; address?: string };
  answers: Record<string, string[]>;
};

export type JobListRow = {
  id: string;
  status: JobStatus;
  pricingMode: 'FIXED' | 'QUOTED';
  request: JobRequest;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; phone: string } | null;
  provider: { id: string; name: string } | null;
};

export type JobEvent = {
  id: string;
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  actor: 'CUSTOMER' | 'PROVIDER' | 'SYSTEM';
  metadata: Record<string, string | number | boolean | null> | null;
  createdAt: string;
};

export type Timer = {
  id: string;
  jobId: string;
  kind: string;
  dueAt: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};

export type Incident = {
  id: string;
  kind: 'server_error' | 'timer_failed' | 'timer_worker_error';
  title: string;
  detail: Record<string, unknown> | null;
  jobId: string | null;
  lastRequestId: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'OPEN' | 'RESOLVED';
  resolvedAt: string | null;
  resolutionNote: string | null;
};

export type JobDetail = {
  job: JobRequest & {
    id: string;
    status: JobStatus;
    pricingMode: 'FIXED' | 'QUOTED';
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    cancellation?: { by: string; reason: string; fromStatus: JobStatus };
  };
  customer: { id: string; name: string; phone: string; status: string } | null;
  provider: {
    id: string;
    name: string;
    phone: string;
    status: string;
    type: string;
    businessName: string | null;
    specialty: string;
    verification: string;
    online: boolean;
  } | null;
  providerIsOffer: boolean;
  money: {
    charged: number;
    paid: number;
    refunded: number;
    releasedToProvider: number;
    commission: number;
    heldInEscrow: number;
  };
  events: JobEvent[];
  charges: { id: string; purpose: string; amount: number; description: string; createdAt: string }[];
  payments: {
    id: string;
    purpose: string;
    amount: number;
    status: string;
    phone: string;
    receiptNumber: string | null;
    failureReason: string | null;
    createdAt: string;
  }[];
  refunds: { id: string; amount: number; reason: string; status: string; createdAt: string }[];
  releases: { id: string; gross: number; commission: number; net: number; createdAt: string }[];
  quotes: {
    id: string;
    kind: string;
    issuedBy: string;
    version: number;
    status: string;
    total: number;
    note: string | null;
    items: {
      id: string;
      serviceCode: string;
      kind: string;
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }[];
    createdAt: string;
  }[];
  timers: Timer[];
  incidents: Incident[];
};

export type SystemNumbers = {
  timersPending: number;
  timersOverdue: number;
  timersFailed: number;
  incidentsOpen: number;
};

export type Health = SystemNumbers & {
  database: { ok: boolean; responseMs: number };
  uptimeSeconds: number;
};

export type Dashboard = {
  system?: SystemNumbers;
  jobs?: {
    active: Partial<Record<JobStatus, number>>;
    today: { created: number; completed: number; cancelled: number };
  };
  settings?: { callOutFee: number };
};
