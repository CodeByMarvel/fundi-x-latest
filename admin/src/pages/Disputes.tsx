import { useEffect, useState } from 'react';
import { api } from '../api';
import { JobLink } from '../components/JobLink';
import { ago, humanize, ksh, when } from '../format';
import { href } from '../route';
import type { DisputeRow } from '../types';

/**
 * Customer care → Disputes: customers who reported a problem after the
 * work. Open ones oldest first, since they've waited longest. Deciding
 * happens on the job's page, with its whole history in view.
 */
export function Disputes() {
  const [state, setState] = useState<'open' | 'resolved'>('open');
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<DisputeRow[]>(`/disputes?state=${state}`).then(setRows, err => setError(err.message));
  }, [state]);

  return (
    <>
      <div className="page-head">
        <h1>Disputes</h1>
        <div className="tabs">
          <button className={state === 'open' ? 'tab active' : 'tab'} onClick={() => setState('open')}>
            Waiting for a decision
          </button>
          <button className={state === 'resolved' ? 'tab active' : 'tab'} onClick={() => setState('resolved')}>
            Decided
          </button>
        </div>
      </div>
      <p className="muted">
        The money for a disputed job stays held until you decide. Open one to see its timeline,
        payments and notes, then resolve it there.
      </p>
      {error && <p className="notice error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.length === 0 && (
        <p className="muted">{state === 'open' ? 'No disputes waiting. ✓' : 'No disputes decided yet.'}</p>
      )}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="clickable-rows">
            <thead>
              <tr>
                <th>Job</th>
                <th>What the customer said</th>
                <th>Customer</th>
                <th>Mechanic</th>
                <th className="num">Held</th>
                <th>{state === 'open' ? 'Waiting' : 'Decision'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id} onClick={() => (window.location.hash = href({ page: 'job', id: d.id }))}>
                  <td>
                    <JobLink id={d.id} />
                    <div className="muted small">
                      {humanize(d.request.categoryId)} · {d.request.vehicle.make} {d.request.vehicle.model}
                    </div>
                  </td>
                  <td>“{d.dispute?.reason}”</td>
                  <td>{d.customer?.name ?? '—'}</td>
                  <td>{d.provider?.name ?? '—'}</td>
                  <td className="num">{ksh(d.heldInEscrow)}</td>
                  <td className="nowrap">
                    {state === 'open' ? (
                      <span title={when(d.updatedAt)}>{ago(d.updatedAt)}</span>
                    ) : (
                      <>
                        {humanize(d.dispute?.resolution?.outcome ?? '')}
                        <div className="muted small">{d.dispute?.resolution && when(d.dispute.resolution.at)}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
