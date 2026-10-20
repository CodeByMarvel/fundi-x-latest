import { useCallback, useEffect, useState } from 'react';
import { api, type Health, type Incident, type Permission, type Timer } from '../api';
import { JobLink } from '../components/JobLink';
import { ReasonForm } from '../components/ReasonForm';
import { ago, duration, humanize, when } from '../format';
import type { RequestLog, SystemInfo } from '../types';
import { useEvery } from '../useEvery';

const KIND: Record<Incident['kind'], string> = {
  server_error: 'Server error',
  timer_failed: 'Timer failed',
  timer_worker_error: 'Timer worker crashed',
};

export function Engineering({ can }: { can: (p: Permission) => boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  const [timers, setTimers] = useState<{ failed: Timer[]; overdue: Timer[] } | null>(null);
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [list, setList] = useState<Incident[] | null>(null);

  const load = useCallback(() => {
    api<Health>('/health').then(
      h => {
        setHealth(h);
        setDown(false);
      },
      () => setDown(true),
    );
    api<{ failed: Timer[]; overdue: Timer[] }>('/timers/attention').then(setTimers, () => {});
    api<Incident[]>(`/incidents?status=${tab}`).then(setList, () => {});
  }, [tab]);
  useEffect(load, [load]);
  useEvery(load, 30_000);

  const attention = timers ? [...timers.failed, ...timers.overdue] : [];

  return (
    <>
      <div className="page-head">
        <h1>System health</h1>
        <button className="secondary" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="muted">
        Problems the server noticed by itself. Refreshes every 30 seconds.
        Every error answer the apps get carries a request id (<code>req_…</code>);
        search for it here or in the server log.
      </p>

      {down && <p className="notice error">The server is not answering.</p>}
      {health && (
        <div className="cards">
          <div className="card">
            <h3>Database</h3>
            <p className="stat good">OK</p>
            <span className="muted small">answered in {health.database.responseMs} ms</span>
          </div>
          <div className="card">
            <h3>Server up for</h3>
            <p className="stat">{duration(health.uptimeSeconds)}</p>
          </div>
          <div className="card">
            <h3>Timers waiting</h3>
            <p className="stat">{health.timersPending}</p>
          </div>
          <div className="card">
            <h3>Timers overdue</h3>
            <p className={`stat ${health.timersOverdue ? 'warn' : ''}`}>{health.timersOverdue}</p>
          </div>
          <div className="card">
            <h3>Timers failed</h3>
            <p className={`stat ${health.timersFailed ? 'bad' : ''}`}>{health.timersFailed}</p>
          </div>
          <div className="card">
            <h3>Open incidents</h3>
            <p className={`stat ${health.incidentsOpen ? 'bad' : 'good'}`}>{health.incidentsOpen}</p>
          </div>
        </div>
      )}

      {attention.length > 0 && (
        <section className="panel">
          <h2>Timers needing a person</h2>
          <p className="muted small">
            Failed timers stopped retrying. Overdue ones should have fired over
            2 minutes ago, which usually means the timer worker is stuck.
          </p>
          {attention.map(t => (
            <TimerRow key={t.id} timer={t} canRetry={can('timers.retry')} onDone={load} />
          ))}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Incidents</h2>
          <div className="tabs">
            {(['OPEN', 'RESOLVED'] as const).map(t => (
              <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
                {t === 'OPEN' ? 'Open' : 'Resolved'}
              </button>
            ))}
          </div>
        </div>
        {list === null && <p className="muted">Loading…</p>}
        {list?.length === 0 && (
          <p className="muted">{tab === 'OPEN' ? '✓ No open incidents.' : 'None resolved yet.'}</p>
        )}
        {list?.map(i => (
          <IncidentRow key={i.id} incident={i} canResolve={can('incidents.resolve')} onDone={load} />
        ))}
      </section>

      <RecentRequests />
      <AllTimers />
      <System />
    </>
  );
}

type RequestFilter = 'all' | 'errors' | 'server_errors' | 'slow';

const REQUEST_FILTERS: { id: RequestFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'errors', label: 'Refused or failed' },
  { id: 'server_errors', label: 'Server errors' },
  { id: 'slow', label: 'Slow (1 s+)' },
];

/** The last few hundred requests this server answered, newest first. */
function RecentRequests() {
  const [filter, setFilter] = useState<RequestFilter>('errors');
  const [data, setData] = useState<RequestLog | null>(null);
  const load = useCallback(() => {
    api<RequestLog>(`/requests?filter=${filter}`).then(setData, () => {});
  }, [filter]);
  useEffect(load, [load]);
  useEvery(load, 30_000);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recent requests</h2>
        <div className="tabs">
          {REQUEST_FILTERS.map(f => (
            <button key={f.id} className={f.id === filter ? 'tab active' : 'tab'} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {data && (
        <p className="muted small">
          {data.totals.seen} requests since this server started (kept in memory, newest 500) ·{' '}
          {data.totals.errors} refused or failed · {data.totals.serverErrors} server errors · slowest{' '}
          {data.totals.slowestMs} ms. 4xx answers are usually the app being refused on purpose
          (wrong step, no permission); 5xx are bugs and also appear as incidents.
        </p>
      )}
      {data?.requests.length === 0 && <p className="muted">None. ✓</p>}
      {!!data?.requests.length && (
        <div className="table-wrap">
          <table>
            <tbody>
              {data.requests.map(r => (
                <tr key={r.requestId} className={r.status >= 500 ? 'warn' : ''}>
                  <td className="nowrap muted small">{ago(r.at)}</td>
                  <td className="mono small">
                    {r.method} {r.route ?? r.path}
                  </td>
                  <td>
                    <span className={r.status >= 500 ? 'badge bad' : r.status >= 400 ? 'badge wait' : 'badge done'}>
                      {r.status}
                    </span>
                  </td>
                  <td className="num small">{r.ms} ms</td>
                  <td className="small">{r.who ?? <span className="muted">signed out</span>}</td>
                  <td className="mono small muted">{r.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Every timer (newest due first): what the server will do next, and what it did. */
function AllTimers() {
  const [status, setStatus] = useState<'' | Timer['status']>('PENDING');
  const [rows, setRows] = useState<Timer[] | null>(null);
  useEffect(() => {
    api<Timer[]>(`/timers${status ? `?status=${status}` : ''}`).then(setRows, () => {});
  }, [status]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Timers</h2>
        <select value={status} onChange={e => setStatus(e.target.value as '' | Timer['status'])} aria-label="Timer status">
          <option value="PENDING">Waiting</option>
          <option value="DONE">Done</option>
          <option value="FAILED">Failed</option>
          <option value="">All</option>
        </select>
      </div>
      {rows?.length === 0 && <p className="muted">None.</p>}
      {!!rows?.length && (
        <div className="table-wrap">
          <table>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} className={t.status === 'FAILED' ? 'warn' : ''}>
                  <td>{humanize(t.kind)}</td>
                  <td>
                    <JobLink id={t.jobId} />
                  </td>
                  <td>{humanize(t.status)}</td>
                  <td className="nowrap">due {when(t.dueAt)}</td>
                  <td className="muted small">{t.lastError ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const FEATURES: Record<string, { label: string; inProduction: boolean }> = {
  googleSignIn: { label: 'Google sign-in (app)', inProduction: true },
  appleSignIn: { label: 'Apple sign-in (app)', inProduction: true },
  adminDevSignIn: { label: 'Admin development sign-in', inProduction: false },
  devUserHeader: { label: 'Development user header (tests, demo)', inProduction: false },
  simulatedMpesa: { label: 'Simulated M-Pesa phone', inProduction: false },
};

/** What's running. Switches only: secrets are never sent to the portal. */
function System() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    api<SystemInfo>('/system').then(setInfo, () => {});
  }, []);
  if (!info) {
    return null;
  }
  return (
    <section className="panel">
      <h2>System</h2>
      <div className="grid-2">
        <dl>
          <dt>Environment</dt>
          <dd>{info.server.environment}</dd>
          <dt>Node.js</dt>
          <dd>{info.server.node}</dd>
          <dt>Started</dt>
          <dd>{when(info.server.startedAt)}</dd>
          <dt>Release</dt>
          <dd className="mono">{info.server.commit ?? 'not set (COMMIT_SHA)'}</dd>
          <dt>Database</dt>
          <dd>
            {info.database.version} · {(info.database.bytes / 1_048_576).toFixed(1)} MB
          </dd>
          <dt>Migrations</dt>
          <dd>
            {info.database.migrations
              ? `${info.database.migrations.count} applied${info.database.migrations.lastAt ? `, last ${when(info.database.migrations.lastAt)}` : ''}`
              : 'unknown'}
          </dd>
        </dl>
        <div>
          <h3 className="small">Switches</h3>
          <ul className="activity">
            {Object.entries(info.features).map(([key, on]) => {
              const meta = FEATURES[key];
              const wrong = info.server.environment === 'production' && on && meta && !meta.inProduction;
              return (
                <li key={key} className={wrong ? 'warn' : ''}>
                  <span>{meta?.label ?? key}</span>
                  <span className={on ? (wrong ? 'error' : 'ok') : 'muted'}>{on ? 'on' : 'off'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <details>
        <summary className="small">Rows per table (approximate)</summary>
        <table>
          <tbody>
            {info.database.tables.map(t => (
              <tr key={t.table}>
                <td className="mono small">{t.table}</td>
                <td className="num">{t.rows.toLocaleString('en-KE')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function TimerRow({ timer, canRetry, onDone }: { timer: Timer; canRetry: boolean; onDone: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className={`item ${timer.status === 'FAILED' ? 'bad' : 'warn'}`}>
      <div className="item-head">
        <div>
          <strong>{humanize(timer.kind)}</strong>{' '}
          <span className="muted small">
            · {timer.status === 'FAILED' ? `failed after ${timer.attempts} tries` : 'overdue'} · due{' '}
            {when(timer.dueAt)} · job <JobLink id={timer.jobId} />
          </span>
          {timer.lastError && <div className="small error">{timer.lastError}</div>}
        </div>
        {canRetry && timer.status === 'FAILED' && !retrying && (
          <button className="secondary" onClick={() => setRetrying(true)}>
            Retry
          </button>
        )}
      </div>
      {retrying && (
        <ReasonForm
          prompt="Why retry? (e.g. the cause was fixed)"
          confirmLabel="Retry timer"
          onCancel={() => setRetrying(false)}
          onSubmit={async reason => {
            await api(`/timers/${timer.id}/retry`, 'POST', { reason });
            onDone();
          }}
        />
      )}
    </div>
  );
}

function IncidentRow({
  incident: i,
  canResolve,
  onDone,
}: {
  incident: Incident;
  canResolve: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  return (
    <div className={`item ${i.status === 'OPEN' ? 'bad' : ''}`}>
      <div className="item-head">
        <div>
          <span className="badge bad">{KIND[i.kind]}</span> <strong>{i.title}</strong>
          <div className="muted small">
            ×{i.count} · first {when(i.firstSeenAt)} · last {ago(i.lastSeenAt)}
            {i.jobId && (
              <>
                {' '}
                · job <JobLink id={i.jobId} />
              </>
            )}
            {i.lastRequestId && (
              <>
                {' '}
                · <span className="mono">{i.lastRequestId}</span>
              </>
            )}
          </div>
          {i.status === 'RESOLVED' && (
            <div className="small ok">
              Resolved {i.resolvedAt && when(i.resolvedAt)}: “{i.resolutionNote}”
            </div>
          )}
        </div>
        <div className="row">
          <button className="link" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide details' : 'Details'}
          </button>
          {canResolve && i.status === 'OPEN' && !resolving && (
            <button className="secondary" onClick={() => setResolving(true)}>
              Resolve
            </button>
          )}
        </div>
      </div>
      {open && <pre className="detail">{JSON.stringify(i.detail, null, 2)}</pre>}
      {resolving && (
        <ReasonForm
          prompt="What was done? (e.g. fixed in release 0.3, or not a real problem because…)"
          confirmLabel="Mark resolved"
          onCancel={() => setResolving(false)}
          onSubmit={async reason => {
            await api(`/incidents/${i.id}/resolve`, 'POST', { reason });
            onDone();
          }}
        />
      )}
    </div>
  );
}
