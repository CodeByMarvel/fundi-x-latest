import { useEffect, useState } from 'react';
import { api } from '../api';
import { ago, humanize } from '../format';
import { href, replaceRoute } from '../route';
import type { MechanicRow, Verification } from '../types';

const TABS: { id: Verification | ''; label: string }[] = [
  { id: 'PENDING', label: 'Waiting' },
  { id: 'VERIFIED', label: 'Verified' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: '', label: 'All' },
];

const BADGE: Record<Verification, string> = {
  PENDING: 'badge wait',
  VERIFIED: 'badge done',
  REJECTED: 'badge bad',
};

/**
 * Operations → Mechanics. New sign-ups wait here: until verified they
 * can't go online. Open one to check and decide.
 */
export function Mechanics({ route }: { route: { verification?: Verification } }) {
  const [tab, setTab] = useState<Verification | ''>(route.verification ?? 'PENDING');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MechanicRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      replaceRoute({ page: 'mechanics', ...(tab && { verification: tab }) });
      const params = new URLSearchParams();
      if (tab) {
        params.set('verification', tab);
      }
      if (q.trim()) {
        params.set('q', q.trim());
      }
      api<MechanicRow[]>(`/mechanics?${params}`).then(setRows, err => setError(err.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [tab, q]);

  return (
    <>
      <div className="page-head">
        <h1>Mechanics</h1>
        <div className="tabs">
          {TABS.map(t => (
            <button key={t.label} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'PENDING' && (
        <p className="muted">
          Waiting longest first. Check who they are (name, phone, garage), then verify them so they
          can go online, or reject with what to fix: they see your words in the app.
        </p>
      )}
      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Name, phone, garage or specialty"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      {error && <p className="notice error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">{tab === 'PENDING' ? 'Nobody waiting. ✓' : 'None.'}</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="clickable-rows">
            <thead>
              <tr>
                <th>Mechanic</th>
                <th>Specialty</th>
                <th>Phone</th>
                <th>Status</th>
                <th className="num">Jobs done</th>
                <th className="num">Rating</th>
                <th className="num" title="Declines, late arrivals, withdrawals… in the last 30 days">
                  Issues (30 d)
                </th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id} onClick={() => (window.location.hash = href({ page: 'person', id: m.id }))}>
                  <td>
                    {m.businessName ?? m.name}
                    <div className="muted small">
                      {humanize(m.type)}
                      {m.businessName && ` · ${m.name}`}
                    </div>
                  </td>
                  <td>{m.specialty}</td>
                  <td className="mono">{m.phone ?? '—'}</td>
                  <td>
                    <span className={BADGE[m.verification]}>{humanize(m.verification)}</span>
                    {m.status !== 'ACTIVE' && <span className="badge bad">{humanize(m.status)}</span>}
                    {m.online && <div className="ok small">● online</div>}
                  </td>
                  <td className="num">{m.jobsDone}</td>
                  <td className="num">
                    {m.ratingCount ? `${(m.ratingTotal / m.ratingCount).toFixed(1)} ★` : <span className="muted">—</span>}
                  </td>
                  <td className="num">{m.reliabilityIssues || <span className="muted">0</span>}</td>
                  <td className="nowrap">{ago(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
