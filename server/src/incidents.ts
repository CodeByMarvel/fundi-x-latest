import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from './db/client';
import { incidents, type IncidentKind } from './db/schema';
import { newId } from './ids';

export type IncidentReport = {
  kind: IncidentKind;
  /** Short and stable: the same problem must produce the same title. */
  title: string;
  /** What makes it "the same problem" beyond kind and title (e.g. route). */
  where?: string;
  detail?: Record<string, unknown>;
  jobId?: string | null;
  requestId?: string | null;
};

/**
 * Records a problem for the Engineering page. If the same problem already
 * has an open incident, this counts one more occurrence on it (one atomic
 * statement, so a burst of errors can't create duplicates).
 *
 * Never throws: a failure to record must not turn into a second failure for
 * the request or timer that hit the first one. It logs instead.
 */
export async function reportIncident(
  db: Database,
  report: IncidentReport,
  log: { error: (obj: unknown, msg?: string) => void } = console,
) {
  const fingerprint = createHash('sha256')
    .update(`${report.kind}|${report.where ?? ''}|${report.title}`)
    .digest('hex')
    .slice(0, 32);
  const at = new Date();
  try {
    await db
      .insert(incidents)
      .values({
        id: newId('inc'),
        fingerprint,
        kind: report.kind,
        title: report.title.slice(0, 300),
        detail: report.detail ?? null,
        jobId: report.jobId ?? null,
        lastRequestId: report.requestId ?? null,
        count: 1,
        firstSeenAt: at,
        lastSeenAt: at,
        status: 'OPEN',
      })
      .onConflictDoUpdate({
        target: incidents.fingerprint,
        targetWhere: sql`${incidents.status} = 'OPEN'`,
        set: {
          count: sql`${incidents.count} + 1`,
          lastSeenAt: at,
          detail: report.detail ?? null,
          lastRequestId: report.requestId ?? null,
          jobId: report.jobId ?? null,
        },
      });
  } catch (err) {
    log.error({ err, report }, 'could not record incident');
  }
}

/** The useful parts of an error, for an incident's detail. */
export const describeError = (err: unknown) =>
  err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { message: String(err) };
