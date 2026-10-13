import { useEffect, useState } from 'react';
import {
  api,
  serverHealth,
  type AuditEntry,
  type Permission,
  type SettingRow,
} from '../api';
import { ACTIONS, isWarning, settingValue, when } from '../format';

type Props = {
  can: (p: Permission) => boolean;
  go: (page: 'settings' | 'audit') => void;
};

export function Overview({ can, go }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [fee, setFee] = useState<SettingRow | null>(null);
  const [recent, setRecent] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    serverHealth().then(setOnline);
    if (can('settings.edit')) {
      api<SettingRow[]>('/settings').then(
        rows => setFee(rows.find(r => r.key === 'call_out_fee') ?? null),
        () => {},
      );
    }
    if (can('logs.view')) {
      api<AuditEntry[]>('/audit?limit=6').then(setRecent, () => setRecent([]));
    }
  }, [can]);

  const denied = recent?.filter(a => isWarning(a.action)).length ?? 0;

  return (
    <>
      <h1>Overview</h1>
      <div className="cards">
        <section className="card">
          <h2>Server</h2>
          <p className={`stat ${online === false ? 'bad' : online ? 'good' : ''}`}>
            {online === null ? '…' : online ? 'Online' : 'Not responding'}
          </p>
        </section>
        {can('settings.edit') && (
          <section className="card clickable" onClick={() => go('settings')}>
            <h2>Call-out fee</h2>
            <p className="stat">{fee ? settingValue(fee.key, fee.value) : '…'}</p>
          </section>
        )}
        {can('logs.view') && (
          <section className="card clickable" onClick={() => go('audit')}>
            <h2>Refused sign-ins (recent)</h2>
            <p className={`stat ${denied > 0 ? 'warn' : ''}`}>
              {recent ? denied : '…'}
            </p>
          </section>
        )}
      </div>

      {can('logs.view') && (
        <section className="panel">
          <div className="panel-head">
            <h2>Recent admin activity</h2>
            <button className="link" onClick={() => go('audit')}>
              Full audit log
            </button>
          </div>
          {recent === null && <p className="muted">Loading…</p>}
          {recent?.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul className="activity">
            {recent?.map(a => (
              <li key={a.id} className={isWarning(a.action) ? 'warn' : ''}>
                <span>{ACTIONS[a.action] ?? a.action}</span>
                <span className="muted small">
                  {a.staffEmail ?? (a.after as { email?: string } | null)?.email ?? '—'} ·{' '}
                  {when(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel muted-panel">
        <h2>Coming to this page</h2>
        <p className="muted">
          Live jobs, stuck or failed payments, failed timers and server errors,
          so problems show up here before a customer calls. These arrive with
          the logging step.
        </p>
      </section>
    </>
  );
}
