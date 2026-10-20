import { useEffect, useState } from 'react';
import { api } from '../api';
import { ago, humanize } from '../format';
import { href, replaceRoute } from '../route';
import type { AccountStatus, CustomerRow } from '../types';

const PAGE = 50;

/** Customer care → Customers: find anyone who books through the app. */
export function Customers({ route }: { route: { q?: string } }) {
  const [q, setQ] = useState(route.q ?? '');
  const [status, setStatus] = useState<AccountStatus | ''>('');
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: string) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (q.trim()) {
      params.set('q', q.trim());
    }
    if (status) {
      params.set('status', status);
    }
    if (before) {
      params.set('before', before);
    }
    try {
      const page = await api<CustomerRow[]>(`/customers?${params}`);
      setRows(r => (before ? [...r, ...page] : page));
      setMore(page.length === PAGE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      replaceRoute({ page: 'customers', ...(q.trim() && { q: q.trim() }) });
      load();
    }, 250);
    return () => clearTimeout(timer);
  }, [q, status]);

  return (
    <>
      <h1>Customers</h1>
      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Name, phone (0712…), email or id"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        <select value={status} onChange={e => setStatus(e.target.value as AccountStatus | '')}>
          <option value="">Any account status</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DELETED">Deleted</option>
        </select>
      </div>
      {error && <p className="notice error">{error}</p>}
      <div className="table-wrap">
        <table className="clickable-rows">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th className="num">Jobs</th>
              <th className="num">Open</th>
              <th className="num">Disputes</th>
              <th>Account</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} onClick={() => (window.location.hash = href({ page: 'person', id: c.id }))}>
                <td>
                  {c.name}
                  <div className="muted small">{c.email}</div>
                </td>
                <td className="mono">{c.phone ?? '—'}</td>
                <td className="num">{c.jobs}</td>
                <td className="num">{c.openJobs || <span className="muted">0</span>}</td>
                <td className="num">{c.disputes || <span className="muted">0</span>}</td>
                <td>
                  <span className={c.status === 'ACTIVE' ? 'badge done' : 'badge bad'}>{humanize(c.status)}</span>
                </td>
                <td className="nowrap">{ago(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && !error && <p className="muted">{q ? 'Nobody matches.' : 'No customers yet.'}</p>}
      {loading && <p className="muted">Loading…</p>}
      {more && !loading && (
        <button className="secondary" onClick={() => load(rows[rows.length - 1].createdAt)}>
          Load more
        </button>
      )}
    </>
  );
}
