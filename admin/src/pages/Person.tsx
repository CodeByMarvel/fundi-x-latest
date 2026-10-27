import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Permission } from '../api';
import { JobLink } from '../components/JobLink';
import { Notes } from '../components/Notes';
import { ReasonForm } from '../components/ReasonForm';
import { StatusBadge } from '../components/StatusBadge';
import { ago, humanize, ksh, when } from '../format';
import { href } from '../route';
import type { MechanicRecord, PersonDetail } from '../types';

const RELIABILITY: Record<string, string> = {
  offer_declined: 'Declined an offer',
  offer_expired: 'Let an offer expire',
  withdrew_after_accepting: 'Withdrew after accepting',
  withdrew_en_route: 'Withdrew on the way',
  late: 'Arrived late',
  dispute_rework: 'Had to redo work',
  dispute_split: 'Lost part of a payment in a dispute',
};

type Pending = 'suspend' | 'unsuspend' | 'verify' | 'reject' | null;

/** One app user: a customer or a mechanic, with what support can do. */
export function Person({ id, can }: { id: string; can: (p: Permission) => boolean }) {
  const [data, setData] = useState<PersonDetail | null>(null);
  const [record, setRecord] = useState<MechanicRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(() => {
    api<PersonDetail>(`/users/${encodeURIComponent(id)}`).then(
      d => {
        setData(d);
        if (d.provider) {
          api<MechanicRecord>(`/mechanics/${encodeURIComponent(id)}/record`).then(setRecord, () => {});
        }
      },
      err => setError(err instanceof ApiError && err.status === 404 ? 'Nobody with this id.' : err.message),
    );
  }, [id]);
  useEffect(load, [load]);

  if (error) {
    return <p className="notice error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">Loading…</p>;
  }
  const { user, provider } = data;
  const isMechanic = user.role === 'PROVIDER';
  const back = isMechanic ? href({ page: 'mechanics' }) : href({ page: 'customers' });

  const act = (path: string) => (reason: string) =>
    api(`${path}`, 'POST', { reason }).then(() => {
      setPending(null);
      load();
    });

  return (
    <>
      <a href={back}>← {isMechanic ? 'Mechanics' : 'Customers'}</a>
      <div className="page-head job-head">
        <div>
          <h1>{provider?.businessName ?? user.name}</h1>
          <p className="muted small">
            {isMechanic ? `${humanize(provider?.type ?? 'mechanic')} · ${user.name}` : 'Customer'} ·{' '}
            <span className="mono">{user.id}</span>
          </p>
        </div>
        <div className="row">
          <span className={user.status === 'ACTIVE' ? 'badge done' : 'badge bad'}>{humanize(user.status)}</span>
          {provider && (
            <span className={provider.verification === 'VERIFIED' ? 'badge done' : provider.verification === 'PENDING' ? 'badge wait' : 'badge bad'}>
              {humanize(provider.verification)}
            </span>
          )}
        </div>
      </div>

      {(data.canSuspend || (provider && can('providers.verify'))) && (
        <section className="panel">
          <h2>Actions</h2>
          {!pending && (
            <div className="row">
              {provider && can('providers.verify') && provider.verification !== 'VERIFIED' && (
                <button className="primary" onClick={() => setPending('verify')}>
                  Verify…
                </button>
              )}
              {provider && can('providers.verify') && provider.verification !== 'REJECTED' && (
                <button className="secondary" onClick={() => setPending('reject')}>
                  {provider.verification === 'VERIFIED' ? 'Withdraw verification…' : 'Reject…'}
                </button>
              )}
              {data.canSuspend && user.status === 'ACTIVE' && (
                <button className="secondary danger" onClick={() => setPending('suspend')}>
                  Suspend account…
                </button>
              )}
              {data.canSuspend && user.status === 'SUSPENDED' && (
                <button className="secondary" onClick={() => setPending('unsuspend')}>
                  Lift suspension…
                </button>
              )}
            </div>
          )}
          {pending === 'verify' && (
            <ReasonForm
              prompt="Verify this mechanic: they can go online and get jobs. What did you check?"
              confirmLabel="Verify"
              onCancel={() => setPending(null)}
              onSubmit={act(`/mechanics/${user.id}/verify`)}
            />
          )}
          {pending === 'reject' && (
            <ReasonForm
              prompt="The mechanic sees this in the app, so say what to fix (e.g. “Add a clear photo of your ID”)."
              confirmLabel="Reject"
              onCancel={() => setPending(null)}
              onSubmit={act(`/mechanics/${user.id}/reject`)}
            />
          )}
          {pending === 'suspend' && (
            <ReasonForm
              prompt={`Suspend ${user.name}: every request from their app is refused until lifted${isMechanic ? ', and they go offline' : ''}. Why?`}
              confirmLabel="Suspend"
              onCancel={() => setPending(null)}
              onSubmit={act(`/users/${user.id}/suspend`)}
            />
          )}
          {pending === 'unsuspend' && (
            <ReasonForm
              prompt="Lift the suspension. Why?"
              confirmLabel="Lift it"
              onCancel={() => setPending(null)}
              onSubmit={act(`/users/${user.id}/unsuspend`)}
            />
          )}
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>Account</h2>
          <dl>
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Phone</dt>
            <dd className="mono">
              {user.phone ?? '—'}
              {user.phone && (
                <span className="muted small"> · {user.phoneVerifiedAt ? 'proven by M-Pesa' : 'not yet proven'}</span>
              )}
            </dd>
            <dt>Email</dt>
            <dd>{user.email ?? '—'}</dd>
            <dt>Signs in with</dt>
            <dd>{user.signsInWith.join(', ') || 'Development only'}</dd>
            <dt>Joined</dt>
            <dd>{when(user.createdAt)}</dd>
            <dt>Signed in on</dt>
            <dd>
              {data.sessions.active} device{data.sessions.active === 1 ? '' : 's'}
              {data.sessions.lastUsedAt && <span className="muted small"> · last seen {ago(data.sessions.lastUsedAt)}</span>}
            </dd>
          </dl>
        </section>

        {provider ? (
          <section className="panel">
            <h2>Mechanic profile</h2>
            <dl>
              <dt>Skills</dt>
              <dd>
                {provider.skillLabels.length
                  ? provider.skillLabels.join(', ')
                  : <span className="muted">Not given yet (profile from before skills were asked)</span>}
              </dd>
              <dt>Experience</dt>
              <dd>{provider.experienceYears === null ? '—' : `${provider.experienceYears} year${provider.experienceYears === 1 ? '' : 's'}`}</dd>
              <dt>Gets around by</dt>
              <dd>{provider.transport ? humanize(provider.transport) : '—'}</dd>
              <dt>Works from</dt>
              <dd>
                {provider.baseLat !== null && provider.baseLng !== null ? (
                  <>
                    {provider.baseDescription}{' '}
                    <a
                      href={`https://www.google.com/maps?q=${provider.baseLat},${provider.baseLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="small"
                    >
                      map
                    </a>
                    <div className="muted small">Takes jobs up to {provider.travelKm} km from here</div>
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Payouts to</dt>
              <dd className="mono">{provider.payoutPhone}</dd>
              <dt>Online</dt>
              <dd>
                {provider.online ? 'Yes' : 'No'}
                {provider.locationAt && <span className="muted small"> · position {ago(provider.locationAt)}</span>}
              </dd>
              <dt>Rating</dt>
              <dd>
                {provider.ratingCount
                  ? `${(provider.ratingTotal / provider.ratingCount).toFixed(1)} ★ from ${provider.ratingCount}`
                  : 'No ratings yet'}
              </dd>
              <dt>Verification</dt>
              <dd>
                {humanize(provider.verification)}
                {provider.verifiedAt && <span className="muted small"> · {when(provider.verifiedAt)}</span>}
                {provider.verificationNote && <div className="muted small">“{provider.verificationNote}”</div>}
              </dd>
              <dt>Earned</dt>
              <dd>
                {ksh(data.money.earned ?? 0)}
                <span className="muted small"> · Fundi-X fees {ksh(data.money.commission ?? 0)}</span>
              </dd>
            </dl>
          </section>
        ) : (
          <section className="panel">
            <h2>Money</h2>
            <dl>
              <dt>Paid in</dt>
              <dd>{ksh(data.money.paid ?? 0)}</dd>
              <dt>Refunded</dt>
              <dd>{ksh(data.money.refunded ?? 0)}</dd>
            </dl>
          </section>
        )}
      </div>

      {record && (
        <section className="panel">
          <h2>Reliability, last {record.reliability.days} days</h2>
          {Object.keys(record.reliability.counts).length === 0 ? (
            <p className="muted">Nothing against them. ✓</p>
          ) : (
            <ul className="activity">
              {Object.entries(record.reliability.counts).map(([type, n]) => (
                <li key={type}>
                  <span>{RELIABILITY[type] ?? humanize(type)}</span>
                  <strong>{n}×</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Facts, not penalties: thresholds and their effect on matching are still to be agreed
            (job-flow.md §17).
          </p>
        </section>
      )}

      <section className="panel">
        <h2>{isMechanic ? 'Jobs worked' : 'Bookings'}</h2>
        {data.jobs.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <table className="clickable-rows">
            <tbody>
              {data.jobs.map(j => (
                <tr key={j.id} onClick={() => (window.location.hash = href({ page: 'job', id: j.id }))}>
                  <td>
                    <JobLink id={j.id} />
                  </td>
                  <td>
                    {humanize(j.request.categoryId)}
                    <div className="muted small">
                      {j.request.vehicle.make} {j.request.vehicle.model}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="nowrap">{ago(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {record && record.payouts.length > 0 && (
        <section className="panel">
          <h2>Payouts</h2>
          <table>
            <tbody>
              {record.payouts.map(r => (
                <tr key={r.id}>
                  <td className="nowrap muted small">{when(r.createdAt)}</td>
                  <td>
                    <JobLink id={r.jobId} />
                  </td>
                  <td>{r.lines.map(l => humanize(l.purpose)).join(' + ')}</td>
                  <td className="num muted">fee {ksh(r.commission)}</td>
                  <td className="num">{ksh(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Notes targetType="user" targetId={user.id} />
    </>
  );
}
