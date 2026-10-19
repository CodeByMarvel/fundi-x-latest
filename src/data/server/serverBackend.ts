import { request, ServerError } from '../../auth/api';
import { BillingService } from '../../domain/billing/BillingService';
import {
  Charge,
  Payment,
  PaymentError,
  Refund,
  Release,
} from '../../domain/billing/types';
import { Contact, JobRepository } from '../../domain/jobs/JobRepository';
import { JobTransitionError, isTerminalStatus } from '../../domain/jobs/transitions';
import { Job, JobEvent } from '../../domain/jobs/types';
import {
  PriceChangedError,
  PriceEstimate,
  PricingService,
} from '../../domain/pricing/PricingService';
import { ProviderRepository } from '../../domain/providers/ProviderRepository';
import { Provider, ReliabilityEvent } from '../../domain/providers/types';
import {
  AdditionalQuotePendingError,
  QuoteValidationError,
  StaleQuoteError,
} from '../../domain/quotes/quotes';
import { Quote } from '../../domain/quotes/types';
import type { Backend, PhoneResponse } from '../backend';

/**
 * How often the app asks the server what changed. Polling is the simple
 * first version: the screens only read snapshots, so swapping it for push
 * notifications or a socket later changes nothing else.
 */
export const POLL_MS = 3000;

type Money = {
  charges: Charge[];
  payments: Payment[];
  refunds: Refund[];
  releases: Release[];
};

/**
 * The real backend: the same four interfaces the mock implements, backed
 * by the Fundi-X server. Who is calling comes from the session token, so
 * the `providerId` arguments the interfaces carry are not sent: the server
 * never takes the caller's word for who they are.
 *
 * Reads are snapshots of what the server last said, refreshed every
 * POLL_MS and straight after each action. Unchanged records keep the same
 * object, so React only re-renders what really changed.
 */
export function createServerBackend({
  token,
  role,
}: {
  token: string;
  role: 'customer' | 'provider';
}): Backend {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const jobs = new Map<string, Job>();
  const money = new Map<string, Money>();
  const providers = new Map<string, Provider>();
  let jobList: readonly Job[] = [];
  let quoteList: readonly Quote[] = [];
  let charges: readonly Charge[] = [];
  let payments: readonly Payment[] = [];
  let refunds: readonly Refund[] = [];
  let releases: readonly Release[] = [];
  let myReleases: readonly Release[] = [];
  let providerList: readonly Provider[] = [];
  let reliability: readonly ReliabilityEvent[] = [];
  let stopped = false;
  /** Provider side: the signed-in mechanic, once /provider/me has answered. */
  let myId: string | undefined;

  /** A server call, with its refusals turned into the errors screens know. */
  const api = async <T>(path: string, method = 'GET', body?: unknown) => {
    try {
      return await request<T>(path, {
        method,
        token,
        ...(body !== undefined && { body }),
      });
    } catch (err) {
      throw translate(err, path);
    }
  };

  function translate(err: unknown, path: string) {
    if (!(err instanceof ServerError)) {
      return err;
    }
    switch (err.code) {
      case 'job_transition': {
        const status = jobs.get(path.split('/')[2])?.status ?? 'SEARCHING';
        return new JobTransitionError(status, status, role === 'customer' ? 'CUSTOMER' : 'PROVIDER');
      }
      case 'price_changed':
        return new PriceChangedError();
      case 'invalid_quote':
        return new QuoteValidationError(err.message);
      case 'stale_quote':
        return new StaleQuoteError();
      case 'additional_quote_pending':
        return new AdditionalQuotePendingError();
      case 'payment_refused':
        return new PaymentError(err.message);
      default:
        return err;
    }
  }

  // ---- Keeping the snapshots ----

  /** Same object when nothing changed, so React can skip the re-render. */
  const same = <T>(a: T | undefined, b: T) =>
    a !== undefined && JSON.stringify(a) === JSON.stringify(b) ? a : b;

  function putJob(job: Job) {
    const kept = same(jobs.get(job.id), job);
    if (kept !== jobs.get(job.id)) {
      jobs.set(job.id, kept);
      jobList = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return true;
    }
    return false;
  }

  function rebuildMoney() {
    const all = [...money.values()];
    const flat = <K extends keyof Money>(k: K) =>
      all.flatMap(m => m[k] as Money[K][number][]);
    const byTime = <T extends { createdAt: string }>(list: T[]) =>
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    charges = same(charges, byTime(flat('charges')));
    payments = same(payments, byTime(flat('payments')));
    refunds = same(refunds, byTime(flat('refunds')));
    // A mechanic's payouts come from two places; count each once.
    const rel = new Map([...myReleases, ...flat('releases')].map(r => [r.id, r]));
    releases = same(releases, byTime([...rel.values()]));
  }

  async function loadJobDetail(jobId: string) {
    const [quotes, jobMoney] = await Promise.all([
      api<Quote[]>(`/jobs/${jobId}/quotes`),
      api<Money>(`/jobs/${jobId}/money`),
    ]);
    const others = quoteList.filter(q => q.jobId !== jobId);
    quoteList = same(
      quoteList,
      [...others, ...quotes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    money.set(jobId, jobMoney);
  }

  async function loadProvider(id: string) {
    const provider = await api<Provider>(`/providers/${id}`);
    providers.set(id, same(providers.get(id), provider));
  }

  async function loadMe() {
    const me = await api<{ provider: Provider; reliability: ReliabilityEvent[] }>('/provider/me');
    myId = me.provider.id;
    providers.set(myId, same(providers.get(myId), me.provider));
    reliability = same(reliability, me.reliability);
    myReleases = await api<Release[]>('/provider/releases');
  }

  /**
   * One look at the server: the job list, then the details of every job
   * that changed or is still under way (its money can change without the
   * job changing, e.g. a failed payment).
   */
  async function refresh() {
    const fresh = (await api<Job[]>('/jobs')).reverse();
    const seen = new Set(fresh.map(j => j.id));
    let changed = false;
    for (const id of [...jobs.keys()]) {
      if (!seen.has(id)) {
        // No longer this caller's (e.g. an offer that went to someone else).
        jobs.delete(id);
        money.delete(id);
        changed = true;
      }
    }
    const needDetail: string[] = [];
    for (const job of fresh) {
      if (putJob(job) || !isTerminalStatus(job.status) || !money.has(job.id)) {
        needDetail.push(job.id);
      }
    }
    if (changed) {
      jobList = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      quoteList = quoteList.filter(q => jobs.has(q.jobId));
    }
    await Promise.all(needDetail.map(loadJobDetail));

    if (role === 'provider') {
      await loadMe();
    } else {
      const assigned = new Set(fresh.flatMap(j => (j.providerId ? [j.providerId] : [])));
      const active = fresh.filter(j => j.providerId && !isTerminalStatus(j.status));
      // Refresh the mechanic on an active job (distance changes); others once.
      const toLoad = [...assigned].filter(
        id => !providers.has(id) || active.some(j => j.providerId === id),
      );
      await Promise.all(toLoad.map(id => loadProvider(id).catch(() => {})));
    }
    providerList = same(providerList, [...providers.values()]);
    rebuildMoney();
    notify();
  }

  /** Never two refreshes at once; one asked for meanwhile runs right after. */
  let running: Promise<void> | null = null;
  let again = false;
  function refreshSoon(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = refresh()
      .catch(() => {
        // Offline or the server is down: keep showing what we had.
      })
      .finally(() => {
        running = null;
        if (again && !stopped) {
          again = false;
          refreshSoon();
        }
      });
    return running;
  }

  const timer = setInterval(() => {
    if (!stopped) {
      refreshSoon();
    }
  }, POLL_MS);
  refreshSoon();

  /** Runs an action, shows its result at once, then catches up on the rest. */
  async function act<T>(path: string, body?: unknown): Promise<T> {
    const result = await api<T>(path, 'POST', body ?? {});
    if (result && typeof result === 'object' && 'status' in result && 'customerId' in result) {
      if (putJob(result as unknown as Job)) {
        notify();
      }
    }
    await refreshSoon();
    return result;
  }

  const jobAction = (name: string) => (jobId: string) =>
    act<Job>(`/jobs/${jobId}/${name}`);

  // ---- The four interfaces ----

  const jobRepository: JobRepository = {
    createJob: async input => {
      const job = await api<Job>('/jobs', 'POST', input);
      putJob(job);
      await refreshSoon();
      return job;
    },
    cancelJob: jobAction('cancel'),
    approveQuote: (jobId, quoteId) => act(`/jobs/${jobId}/approve-quote`, { quoteId }),
    rejectQuote: (jobId, quoteId) => act(`/jobs/${jobId}/reject-quote`, { quoteId }),
    confirmCompletion: jobAction('confirm'),
    disputeCompletion: (jobId, reason) => act(`/jobs/${jobId}/dispute`, { reason }),
    submitRating: (jobId, stars, comment) =>
      act(`/jobs/${jobId}/rate`, { stars, ...(comment.trim() && { comment }) }),

    acceptOffer: jobAction('accept'),
    declineOffer: jobAction('decline'),
    withdrawFromJob: (jobId, _p, note) =>
      act(`/jobs/${jobId}/withdraw`, note.trim() ? { note } : {}),
    startTrip: jobAction('start-trip'),
    markArrived: jobAction('arrived'),
    startInspection: jobAction('start-inspection'),
    readyToStart: jobAction('ready-to-start'),
    reportCustomerNoShow: jobAction('no-show'),
    sendQuote: (jobId, _p, items, note) =>
      act<Quote>(`/jobs/${jobId}/quote`, { items, ...(note?.trim() && { note }) }),
    reviseQuote: jobAction('revise-quote'),
    raiseAdditionalQuote: (jobId, _p, items, reason) =>
      act<Quote>(`/jobs/${jobId}/additional-quote`, { items, reason }),
    markWorkComplete: (jobId, _p, summary) =>
      act(`/jobs/${jobId}/complete`, summary.trim() ? { summary } : {}),

    getJob: async jobId => {
      try {
        const job = await api<Job>(`/jobs/${jobId}`);
        if (putJob(job)) {
          notify();
        }
        return job;
      } catch (err) {
        if (err instanceof ServerError && err.status === 404) {
          return undefined;
        }
        throw err;
      }
    },
    getJobEvents: jobId => api<JobEvent[]>(`/jobs/${jobId}/events`),
    getCustomerContact: async jobId => {
      try {
        return await api<Contact>(`/jobs/${jobId}/contact`);
      } catch (err) {
        if (err instanceof ServerError && err.status === 404) {
          return undefined;
        }
        throw err;
      }
    },
    getJobSnapshot: jobId => jobs.get(jobId),
    getJobsSnapshot: () => jobList,
    getQuoteSnapshot: quoteId => quoteList.find(q => q.id === quoteId),
    getQuotesSnapshot: () => quoteList,
    subscribe,
  };

  const billing: BillingService = {
    initiatePayment: async (jobId, phone, options = {}) => {
      const payment = await api<Payment>(`/jobs/${jobId}/pay`, 'POST', {
        phone,
        ...(options.quoteId && { quoteId: options.quoteId }),
      });
      // Show "check your phone" at once, before the next refresh.
      const current = money.get(jobId) ?? { charges: [], payments: [], refunds: [], releases: [] };
      money.set(jobId, { ...current, payments: [...current.payments, payment] });
      rebuildMoney();
      notify();
      return payment;
    },
    getPaymentSnapshot: paymentId => payments.find(p => p.id === paymentId),
    getChargesSnapshot: () => charges,
    getPaymentsSnapshot: () => payments,
    getRefundsSnapshot: () => refunds,
    getReleasesSnapshot: () => releases,
    subscribe,
  };

  const pricing: PricingService = {
    estimate: details => api<PriceEstimate>('/pricing/estimate', 'POST', details),
  };

  const providerRepository: ProviderRepository = {
    setOnline: async (_p, online, location) => {
      await api('/provider/availability', 'PUT', { online, ...(location && { location }) });
      await loadMe();
      providerList = same(providerList, [...providers.values()]);
      notify();
      return providers.get(myId!)!;
    },
    reportLocation: async location => {
      await api('/provider/location', 'PUT', location);
    },
    getProviderSnapshot: providerId => providers.get(providerId),
    getProvidersSnapshot: () => providerList,
    getReliabilityEventsSnapshot: () => reliability,
    subscribe,
  };

  return {
    jobs: jobRepository,
    billing,
    pricing,
    providers: providerRepository,
    phone: {
      // Development only: the server's stand-in for the customer's handset.
      respondToPaymentPrompt: (paymentId: string, response: PhoneResponse) => {
        api(`/dev/payments/${paymentId}/respond`, 'POST', { response })
          .then(() => refreshSoon())
          .catch(() => {});
      },
    },
    dispose: () => {
      stopped = true;
      clearInterval(timer);
      listeners.clear();
    },
  };
}
