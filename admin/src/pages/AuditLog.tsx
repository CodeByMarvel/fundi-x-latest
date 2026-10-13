import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../api';
import { ACTIONS, isWarning, settingValue, shortId, when } from '../format';

const PAGE = 50;

/** What changed, in one line. */
function change(a: AuditEntry) {
  if (a.action === 'settings.update') {
    return `${settingValue(a.targetId, a.before)} → ${settingValue(a.targetId, a.after)}`;
  }
  const after = a.after as
    | { email?: string; reason?: string; method?: string }
    | null;
  if (a.action === 'timer.retry') {
    const job = (a.after as { jobId?: string } | null)?.jobId;
    return job ? `timer on ${shortId(job)}` : '';
  }
  if (a.action === 'incident.resolve') {
    return (a.before as { title?: string } | null)?.title ?? '';
  }
  if (a.action === 'staff.sign_in') {
    return after?.method === 'dev' ? 'development sign-in' : after?.method ?? '';
  }
  if (a.action === 'staff.sign_in_denied' && after) {
    return `${after.email ?? '?'} (${(after.reason ?? '').replace(/_/g, ' ')})`;
  }
  return '';
}

export function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: string) {
    setLoading(true);
    try {
      const query = `?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
      const page = await api<AuditEntry[]>(`/audit${query}`);
      setRows(r => (before ? [...r, ...page] : page));
      setMore(page.length === PAGE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Audit log</h1>
        <button className="secondary" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <p className="muted">
        Everything done in this console, and every sign-in attempt: who,
        what, when and why. Entries are never edited or deleted.
      </p>
      {error && <p className="notice error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When (Nairobi)</th>
              <th>Who</th>
              <th>What</th>
              <th>Details</th>
              <th>Why</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id} className={isWarning(a.action) ? 'warn' : ''}>
                <td className="nowrap">{when(a.createdAt)}</td>
                <td>{a.staffEmail ?? <span className="muted">not staff</span>}</td>
                <td>
                  {ACTIONS[a.action] ?? a.action}
                  {a.targetType === 'setting' && (
                    <span className="muted small"> · {a.targetId}</span>
                  )}
                </td>
                <td className="nowrap">{change(a)}</td>
                <td>{a.reason ?? ''}</td>
                <td className="muted small mono">{a.ip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && !error && <p className="muted">Nothing yet.</p>}
      {loading && <p className="muted">Loading…</p>}
      {more && !loading && (
        <button className="secondary" onClick={() => load(rows[rows.length - 1].createdAt)}>
          Load older
        </button>
      )}
    </>
  );
}
