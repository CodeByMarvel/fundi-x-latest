/**
 * The most recent requests, kept in memory for the admin portal's
 * Engineering page ("what just happened?"). Not a permanent log: the full
 * log is the server's output (and the host's log storage). Query strings
 * are left out, since searches can contain phone numbers.
 */
export type RequestRecord = {
  requestId: string;
  method: string;
  /** The route pattern, e.g. /jobs/:id/pay, so similar calls group. */
  route: string | null;
  path: string;
  status: number;
  ms: number;
  /** "customer:…", "provider:…" or "staff:…"; null when signed out. */
  who: string | null;
  at: string;
};

export type RequestLog = {
  add(record: RequestRecord): void;
  list(): RequestRecord[];
};

export function createRequestLog(size = 500): RequestLog {
  const records: RequestRecord[] = [];
  return {
    add(record) {
      records.push(record);
      if (records.length > size) {
        records.shift();
      }
    },
    /** Newest first. */
    list: () => [...records].reverse(),
  };
}
