import { useCallback, useEffect, useState } from 'react';
import {
  api,
  serverHealth,
  type AuditEntry,
  type Dashboard as DashboardData,
  type Permission,
} from '../api';
import { ACTIONS, ago, isWarning, ksh } from '../format';
import { STAGES } from '../jobStatus';
import { href } from '../route';
import { useEvery } from '../useEvery';

type Alert = { tone: 'bad' | 'warn'; text: string; link: string };

/** Alerts come first: the dashboard's job is to show what's wrong. */
function alertsFrom(data: DashboardData, online: boolean | null): Alert[] {
  const alerts: Alert[] = [];
  const engineering = href({ page: 'engineering' });
  if (online === false) {
    alerts.push({ tone: 'bad', text: 'The server is not responding', link: engineering });
  }
  const s = data.system;
  if (s?.incidentsOpen) {
    alerts.push({
      tone: 'bad',
      text: `${s.incidentsOpen} open incident${s.incidentsOpen > 1 ? 's' : ''}`,
      link: engineering,
    });
  }
  if (s?.timersFailed) {
    alerts.push({
      tone: 'bad',
      text: `${s.timersFailed} timer${s.timersFailed > 1 ? 's' : ''} failed and need a person`,
      link: engineering,
    });
  }
  if (s?.timersOverdue) {
    alerts.push({
      tone: 'warn',
      text: `${s.timersOverdue} timer${s.timersOverdue > 1 ? 's are' : ' is'} overdue: the timer worker may be stuck`,
      link: engineering,
    });
  }
  const late = data.jobs?.lateArrivals ?? 0;
  if (late) {
    alerts.push({
      tone: 'warn',
      text: `${late} mechanic${late > 1 ? 's are' : ' is'} more than 20 min late: call to check in`,
      link: href({ page: 'jobs', status: 'EN_ROUTE' }),
    });
  }
  const disputed = data.jobs?.openDisputes ?? 0;
  if (disputed) {
    alerts.push({
      tone: 'warn',
      text: `${disputed} dispute${disputed > 1 ? 's' : ''} waiting for a decision: the money stays held until then`,
      link: href({ page: 'disputes' }),
    });
  }
  const failedTransfers = data.money?.transfersFailed ?? 0;
  if (failedTransfers) {
    alerts.push({
      tone: 'bad',
      text: `${failedTransfers} M-Pesa payout${failedTransfers > 1 ? 's or refunds' : ' or refund'} failed: the money is still owed`,
      link: href({ page: 'finance' }),
    });
  }
  const waiting = data.mechanics?.awaitingVerification ?? 0;
  if (waiting) {
    alerts.push({
      tone: 'warn',
      text: `${waiting} mechanic${waiting > 1 ? 's' : ''} waiting to be verified: they can't go online until then`,
      link: href({ page: 'mechanics', verification: 'PENDING' }),
    });
  }
  return alerts;
}

export function Dashboard({ can }: { can: (p: Permission) => boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<AuditEntry[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    serverHealth().then(setOnline);
    api<DashboardData>('/dashboard').then(d => {
      setData(d);
      setCheckedAt(new Date());
    }, () => setOnline(false));
    if (can('logs.view')) {
      api<AuditEntry[]>('/audit?limit=5').then(setRecent, () => setRecent([]));
    }
  }, [can]);
  useEffect(load, [load]);
  useEvery(load, 30_000);

  const alerts = data ? alertsFrom(data, online) : [];
  const active = data?.jobs?.active ?? {};
  const activeTotal = Object.values(active).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <span className="muted small">
          {checkedAt ? `Updated ${checkedAt.toLocaleTimeString('en-KE')} · refreshes every 30 s` : 'Loading…'}
        </span>
      </div>

      {data && (can('logs.view') || online === false) && (
        <section className="alerts">
          {alerts.length === 0 ? (
            <div className="alert ok">✓ No alerts. Everything the server checks is healthy.</div>
          ) : (
            alerts.map(a => (
              <a key={a.text} href={a.link} className={`alert ${a.tone}`}>
                ⚠ {a.text}
              </a>
            ))
          )}
        </section>
      )}

      {data?.jobs && (
        <>
          <div className="section-head">
            <h2>Jobs in progress · {activeTotal}</h2>
            <a href={href({ page: 'jobs' })}>All jobs</a>
          </div>
          <div className="cards">
            {STAGES.map(stage => {
              const n = stage.statuses.reduce((s, st) => s + (active[st] ?? 0), 0);
              const link =
                stage.statuses.length === 1
                  ? href({ page: 'jobs', status: stage.statuses[0] })
                  : href({ page: 'jobs' });
              return (
                <a key={stage.label} href={link} className="card clickable">
                  <h3>{stage.label}</h3>
                  <p className={`stat ${stage.label === 'Disputed' && n ? 'warn' : ''}`}>{n}</p>
                </a>
              );
            })}
          </div>

          <div className="section-head">
            <h2>Today (Nairobi)</h2>
          </div>
          <div className="cards">
            <div className="card">
              <h3>New jobs</h3>
              <p className="stat">{data.jobs.today.created}</p>
            </div>
            <div className="card">
              <h3>Completed</h3>
              <p className="stat good">{data.jobs.today.completed}</p>
            </div>
            <div className="card">
              <h3>Cancelled</h3>
              <p className="stat">{data.jobs.today.cancelled}</p>
            </div>
            {data.settings && (
              <a className="card clickable" href={href({ page: 'settings' })}>
                <h3>Call-out fee</h3>
                <p className="stat">{ksh(data.settings.callOutFee)}</p>
              </a>
            )}
          </div>
        </>
      )}

      {recent && (
        <section className="panel">
          <div className="panel-head">
            <h2>Recent admin activity</h2>
            <a href={href({ page: 'audit' })}>Audit log</a>
          </div>
          {recent.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul className="activity">
            {recent.map(a => (
              <li key={a.id} className={isWarning(a.action) ? 'warn' : ''}>
                <span>
                  {ACTIONS[a.action] ?? a.action}
                  {a.reason && <span className="muted"> · “{a.reason}”</span>}
                </span>
                <span className="muted small">
                  {a.staffEmail ?? (a.after as { email?: string } | null)?.email ?? '—'} ·{' '}
                  {ago(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data?.money && (
        <>
          <div className="section-head">
            <h2>Money now</h2>
            <a href={href({ page: 'finance' })}>Finance</a>
          </div>
          <div className="cards">
            <a className="card clickable" href={href({ page: 'finance' })}>
              <h3>Held in escrow</h3>
              <p className="stat">{ksh(data.money.heldInEscrow)}</p>
            </a>
            <a className="card clickable" href={href({ page: 'finance' })}>
              <h3>Refunds to send</h3>
              <p className={`stat ${data.money.refundsWaiting.count ? 'warn' : ''}`}>
                {ksh(data.money.refundsWaiting.amount)}
              </p>
              <span className="muted small">
                {data.money.refundsWaiting.count} waiting for M-Pesa to confirm
              </span>
            </a>
          </div>
        </>
      )}
    </>
  );
}
