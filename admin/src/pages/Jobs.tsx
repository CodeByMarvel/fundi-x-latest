import { useEffect, useState } from 'react';
import { api, type JobListRow, type JobStatus } from '../api';
import { JobLink } from '../components/JobLink';
import { StatusBadge } from '../components/StatusBadge';
import { ago, humanize } from '../format';
import { ALL_STATUSES, STATUS } from '../jobStatus';
import { href, replaceRoute } from '../route';

const PAGE = 50;

type Props = { route: { status?: JobStatus; q?: string } };

export function Jobs({ route }: Props) {
  const [q, setQ] = useState(route.q ?? '');
  const [status, setStatus] = useState<JobStatus | ''>(route.status ?? '');
  const [rows, setRows] = useState<JobListRow[]>([]);
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
      const page = await api<JobListRow[]>(`/jobs?${params}`);
      setRows(r => (before ? [...r, ...page] : page));
      setMore(page.length === PAGE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Search as you type, after a short pause; keep filters in the address.
  useEffect(() => {
    const timer = setTimeout(() => {
      replaceRoute({ page: 'jobs', ...(status && { status }), ...(q.trim() && { q: q.trim() }) });
      load();
    }, 250);
    return () => clearTimeout(timer);
  }, [q, status]);

  return (
    <>
      <div className="page-head">
        <h1>Jobs</h1>
        <button className="secondary" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Job id, customer name or phone, or plate (KDA 123A)"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        <select value={status} onChange={e => setStatus(e.target.value as JobStatus | '')}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="notice error">{error}</p>}
      <div className="table-wrap">
        <table className="clickable-rows">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Service</th>
              <th>Vehicle</th>
              <th>Customer</th>
              <th>Mechanic</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(job => (
              <tr key={job.id} onClick={() => (window.location.hash = href({ page: 'job', id: job.id }))}>
                <td>
                  <JobLink id={job.id} />
                </td>
                <td>
                  <StatusBadge status={job.status} />
                </td>
                <td>
                  {humanize(job.request.categoryId)}
                  <div className="muted small">
                    {job.request.requestType === 'service' ? 'Service' : 'Repair'} ·{' '}
                    {job.pricingMode === 'FIXED' ? 'fixed price' : 'quoted'}
                  </div>
                </td>
                <td>
                  {job.request.vehicle.make} {job.request.vehicle.model}
                  <div className="muted small mono">{job.request.vehicle.registration}</div>
                </td>
                <td>
                  {job.customer?.name ?? '—'}
                  <div className="muted small">{job.customer?.phone}</div>
                </td>
                <td>{job.provider?.name ?? <span className="muted">—</span>}</td>
                <td className="nowrap" title={job.createdAt}>
                  {ago(job.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && !error && (
        <p className="muted">{q || status ? 'No jobs match.' : 'No jobs yet.'}</p>
      )}
      {loading && <p className="muted">Loading…</p>}
      {more && !loading && (
        <button className="secondary" onClick={() => load(rows[rows.length - 1].createdAt)}>
          Load older
        </button>
      )}
    </>
  );
}
