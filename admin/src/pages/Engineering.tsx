import { useCallback, useEffect, useState } from 'react';
import { api, type Health, type Incident, type Permission, type Timer } from '../api';
import { JobLink } from '../components/JobLink';
import { ReasonForm } from '../components/ReasonForm';
import { ago, duration, humanize, when } from '../format';
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
    </>
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
