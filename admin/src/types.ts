import type { JobRequest, JobStatus } from './api';

// What the customer care, mechanics, finance and engineering endpoints
// return (server/src/admin/support.ts, mechanics.ts, finance.ts,
// engineering.ts).

type Person = { id: string; name: string; phone?: string | null } | null;

export type DisputeInfo = {
  reason: string;
  resolution?: {
    outcome: 'REWORK' | 'UPHOLD_PROVIDER' | 'SPLIT';
    note: string;
    customerRefund?: number;
    providerPayout?: number;
    at: string;
  };
};

export type DisputeRow = {
  id: string;
  status: JobStatus;
  pricingMode: 'FIXED' | 'QUOTED';
  request: JobRequest;
  dispute: DisputeInfo | null;
  updatedAt: string;
  heldInEscrow: number;
  customer: Person;
  provider: Person;
};

export type Note = { id: string; body: string; createdAt: string; staffEmail: string | null };

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: AccountStatus;
  createdAt: string;
  jobs: number;
  openJobs: number;
  disputes: number;
};

export type Verification = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type MechanicRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: AccountStatus;
  type: 'mechanic' | 'garage';
  businessName: string | null;
  specialty: string;
  verification: Verification;
  verificationNote: string | null;
  online: boolean;
  locationAt: string | null;
  ratingTotal: number;
  ratingCount: number;
  createdAt: string;
  jobsDone: number;
  reliabilityIssues: number;
};

export type PersonDetail = {
  user: {
    id: string;
    name: string;
    phone: string | null;
    phoneVerifiedAt: string | null;
    email: string | null;
    role: 'CUSTOMER' | 'PROVIDER';
    status: AccountStatus;
    signsInWith: string[];
    createdAt: string;
  };
  provider: {
    type: 'mechanic' | 'garage';
    businessName: string | null;
    specialty: string;
    payoutPhone: string;
    verification: Verification;
    verificationNote: string | null;
    verifiedAt: string | null;
    online: boolean;
    locationAt: string | null;
    ratingTotal: number;
    ratingCount: number;
  } | null;
  jobs: { id: string; status: JobStatus; pricingMode: 'FIXED' | 'QUOTED'; request: JobRequest; createdAt: string }[];
  sessions: { active: number; lastUsedAt: string | null };
  money: { paid?: number; refunded?: number; earned?: number; commission?: number };
  canSuspend: boolean;
};

export type ReleaseRow = {
  id: string;
  jobId: string;
  providerId?: string;
  providerName?: string | null;
  lines: { paymentId: string; purpose: string; gross: number; commission: number }[];
  gross: number;
  commission: number;
  net: number;
  createdAt: string;
};

export type MechanicRecord = {
  reliability: {
    days: number;
    counts: Record<string, number>;
    events: { id: string; jobId: string; type: string; createdAt: string }[];
  };
  payouts: ReleaseRow[];
};

export type FinanceSummary = {
  period: { from: string; to: string };
  moneyIn: { purpose: string; count: number; amount: number; parts: number }[];
  refunds: { count: number; amount: number };
  earnings: { purpose: string; gross: number; commission: number }[];
  byDay: { day: string; moneyIn: number; commission: number }[];
  now: {
    heldInEscrow: { amount: number; jobs: number };
    refundsWaiting: { count: number; amount: number };
    payoutsRecorded: { count: number; amount: number };
  };
};

export type PaymentRow = {
  id: string;
  jobId: string;
  purpose: string;
  phone: string;
  amount: number;
  partsAmount: number;
  status: string;
  failureReason: string | null;
  receiptNumber: string | null;
  createdAt: string;
};

export type RefundRow = {
  id: string;
  jobId: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: string;
};

export type EscrowRow = {
  id: string;
  status: JobStatus;
  request: JobRequest;
  createdAt: string;
  updatedAt: string;
  heldInEscrow: number;
  customer: Person;
};

export type ProviderEarnings = {
  id: string;
  name: string;
  payoutPhone: string;
  payouts: number;
  gross: number;
  commission: number;
  net: number;
  lastAt: string | null;
};

export type RequestRecord = {
  requestId: string;
  method: string;
  route: string | null;
  path: string;
  status: number;
  ms: number;
  who: string | null;
  at: string;
};

export type RequestLog = {
  requests: RequestRecord[];
  totals: { seen: number; errors: number; serverErrors: number; slow: number; slowestMs: number };
};

export type SystemInfo = {
  server: { node: string; environment: string; startedAt: string; commit: string | null };
  features: Record<string, boolean>;
  database: {
    version: string;
    bytes: number;
    migrations: { count: number; lastAt: string | null } | null;
    tables: { table: string; rows: number }[];
  };
};

export type Books = {
  check: {
    ok: boolean;
    total: number;
    escrowMismatches: { jobId: string; records: number; books: number }[];
    missingEntries: { kind: string; id: string }[];
    overdrawn: { account: string; balance: number }[];
  };
  totals: { mpesa: number; escrow: number; owedToMechanics: number; owedToCustomers: number; revenue: number };
};

export type LedgerEntry = {
  id: string;
  kind: string;
  description: string;
  createdAt: string;
  lines: { account: string; amount: number }[];
};

export type TransferStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'SUCCESS' | 'FAILED';

export type Transfer = {
  id: string;
  kind: 'PAYOUT' | 'REFUND';
  jobId: string;
  recipientId: string;
  recipientName?: string | null;
  phone: string;
  amount: number;
  status: TransferStatus;
  conversationId: string | null;
  receiptNumber: string | null;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
};
