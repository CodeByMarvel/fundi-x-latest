import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, ApiError, type JobDetail as Detail, type JobEvent, type Permission } from '../api';
import { Interventions } from '../components/Interventions';
import { Notes } from '../components/Notes';
import { StatusBadge } from '../components/StatusBadge';
import { humanize, ksh, when } from '../format';
import { mainPath, STATUS } from '../jobStatus';
import { href } from '../route';

const ACTOR: Record<JobEvent['actor'], string> = {
  CUSTOMER: 'Customer',
  PROVIDER: 'Mechanic',
  SYSTEM: 'Fundi-X',
};

/** An event's metadata, as readable "key: value" pairs. */
function describe(metadata: JobEvent['metadata']) {
  if (!metadata) {
    return [];
  }
  return Object.entries(metadata)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => {
      const money = typeof v === 'number' && /total|amount|callOut|fee/i.test(k);
      return `${humanize(k.replace(/([A-Z])/g, ' $1'))}: ${money ? ksh(v as number) : String(v)}`;
    });
}

export function JobDetail({ id, can }: { id: string; can: (p: Permission) => boolean }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/jobs/${encodeURIComponent(id)}`).then(setData, err =>
      setError(err instanceof ApiError && err.status === 404 ? 'No job with this id.' : err.message),
    );
  }, [id]);
  useEffect(load, [load]);

  if (error) {
    return (
      <>
        <a href={href({ page: 'jobs' })}>← Jobs</a>
        <p className="notice error">{error}</p>
      </>
    );
  }
  if (!data) {
    return <p className="muted">Loading…</p>;
  }

  const { job, money } = data;
  const reached = new Set(data.events.map(e => e.toStatus));
  const path = mainPath(job.pricingMode);
  const offPath = !path.includes(job.status);

  return (
    <>
      <a href={href({ page: 'jobs' })}>← Jobs</a>
      <div className="page-head job-head">
        <div>
          <h1>
            {humanize(job.categoryId)}{' '}
            <span className="muted">· {job.vehicle.make} {job.vehicle.model}</span>
          </h1>
          <p className="muted small mono">{job.id}</p>
        </div>
        <div className="row">
          <StatusBadge status={job.status} />
          <button className="secondary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {/* Where the job is in the state machine (docs/admin-portal.md §4). */}
      <section className="panel">
        <h2>Progress</h2>
        <ol className="stepper">
          {path.map(s => (
            <li
              key={s}
              className={s === job.status ? 'current' : reached.has(s) ? 'reached' : ''}
              title={s}
            >
              <span className="dot" />
              <span className="step-label">{STATUS[s].label}</span>
            </li>
          ))}
        </ol>
        {offPath && (
          <p className={`notice ${job.status === 'DISPUTED' ? 'error' : ''}`}>
            {STATUS[job.status].label}
            {job.cancellation &&
              ` by ${job.cancellation.by.toLowerCase()} at "${STATUS[job.cancellation.fromStatus]?.label ?? job.cancellation.fromStatus}" · ${humanize(job.cancellation.reason)}`}
          </p>
        )}
      </section>

      <Interventions data={data} can={can} onDone={load} />

      {job.dispute?.resolution && (
        <section className="panel">
          <h2>Dispute</h2>
          <p>
            Customer said: “{job.dispute.reason}”
            <br />
            Decision: <strong>{humanize(job.dispute.resolution.outcome)}</strong> · “{job.dispute.resolution.note}”{' '}
            <span className="muted small">{when(job.dispute.resolution.at)}</span>
            {job.dispute.resolution.outcome === 'SPLIT' && (
              <span className="muted small">
                {' '}
                · refund {ksh(job.dispute.resolution.customerRefund ?? 0)}, mechanic{' '}
                {ksh(job.dispute.resolution.providerPayout ?? 0)}
              </span>
            )}
          </p>
        </section>
      )}

      {data.incidents.length > 0 && (
        <section className="panel alert-panel">
          <h2>Incidents on this job</h2>
          {data.incidents.map(i => (
            <p key={i.id}>
              <a href={href({ page: 'engineering' })}>{i.title}</a>{' '}
              <span className="muted small">
                · {i.status === 'OPEN' ? 'open' : 'resolved'} · ×{i.count}
              </span>
            </p>
          ))}
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>Customer</h2>
          {data.customer ? (
            <dl>
              <dt>Name</dt>
              <dd>
                <a href={href({ page: 'person', id: data.customer.id })}>{data.customer.name}</a>
              </dd>
              <dt>Phone</dt>
              <dd className="mono">{data.customer.phone}</dd>
              <dt>Account</dt>
              <dd>{humanize(data.customer.status)}</dd>
            </dl>
          ) : (
            <p className="muted">Unknown</p>
          )}
        </section>
        <section className="panel">
          <h2>Mechanic{data.providerIsOffer && ' (offered, not yet accepted)'}</h2>
          {data.provider ? (
            <dl>
              <dt>Name</dt>
              <dd>
                <a href={href({ page: 'person', id: data.provider.id })}>
                  {data.provider.businessName ?? data.provider.name}
                </a>
                <span className="muted small"> · {data.provider.type}</span>
              </dd>
              <dt>Phone</dt>
              <dd className="mono">{data.provider.phone}</dd>
              <dt>Specialty</dt>
              <dd>{data.provider.specialty}</dd>
              <dt>Verified</dt>
              <dd>{humanize(data.provider.verification)}</dd>
            </dl>
          ) : (
            <p className="muted">Not assigned yet.</p>
          )}
        </section>
        <section className="panel">
          <h2>Request</h2>
          <dl>
            <dt>Vehicle</dt>
            <dd>
              {job.vehicle.make} {job.vehicle.model}
              {job.vehicle.year && ` (${job.vehicle.year})`}
              {job.vehicle.engineCc && ` · ${job.vehicle.engineCc} cc`}
              {job.vehicle.fuel && ` ${job.vehicle.fuel}`} ·{' '}
              <span className="mono">{job.vehicle.registration}</span>
            </dd>
            <dt>Type</dt>
            <dd>
              {job.requestType === 'service' ? 'Service' : 'Repair'} ·{' '}
              {job.pricingMode === 'FIXED' ? 'fixed price' : 'quoted on site'}
            </dd>
            {job.partsOption && (
              <>
                <dt>Parts</dt>
                <dd>{job.partsOption === 'MECHANIC' ? 'Mechanic brings them' : "Customer's own"}</dd>
              </>
            )}
            {job.reassignment && (
              <>
                <dt>Reassigned</dt>
                <dd>
                  {when(job.reassignment.at)}
                  {job.reassignment.note && ` · “${job.reassignment.note}”`}
                </dd>
              </>
            )}
            <dt>Where</dt>
            <dd>
              {job.location.label}
              {job.location.address && ` · ${job.location.address}`}
            </dd>
            <dt>Search</dt>
            <dd>
              {data.matching.ring === null
                ? 'Not started'
                : `Reached ring ${data.matching.ring} of ${data.matching.maxRing} (about ${(data.matching.ring * 0.9).toFixed(1)} km)`}
              {data.matching.zone && (
                <span className="muted small">
                  {' '}
                  · zone <span className="mono">{data.matching.zone}</span>
                </span>
              )}
            </dd>
            <dt>Urgency</dt>
            <dd>{humanize(job.urgency)}</dd>
            <dt>Drivable</dt>
            <dd>{humanize(job.drivability)}</dd>
            {job.description && (
              <>
                <dt>Described</dt>
                <dd>“{job.description}”</dd>
              </>
            )}
            {Object.entries(job.answers).map(([q, a]) => (
              <Fragment key={q}>
                <dt>{humanize(q.split('.').pop() ?? q)}</dt>
                <dd>{a.map(humanize).join(', ')}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
        <section className="panel">
          <h2>Money</h2>
          <dl className="money">
            <dt>Charged</dt>
            <dd>{ksh(money.charged)}</dd>
            <dt>Paid into escrow</dt>
            <dd>{ksh(money.paid)}</dd>
            <dt>Refunded</dt>
            <dd>{ksh(money.refunded)}</dd>
            <dt>Paid to mechanic</dt>
            <dd>{ksh(money.releasedToProvider)}</dd>
            <dt>Fundi-X commission</dt>
            <dd>{ksh(money.commission)}</dd>
            <dt>
              <strong>Held in escrow now</strong>
            </dt>
            <dd>
              <strong>{ksh(money.heldInEscrow)}</strong>
            </dd>
          </dl>
          <p className="muted small">Calculated from the payment records below, never stored.</p>
        </section>
      </div>

      <section className="panel">
        <h2>Timeline</h2>
        <ol className="timeline">
          {data.events.map(e => (
            <li key={e.id}>
              <span className="time">{when(e.createdAt)}</span>
              <div>
                <strong>{ACTOR[e.actor]}</strong>{' '}
                {e.fromStatus ? (
                  <>
                    moved it from {STATUS[e.fromStatus]?.label ?? e.fromStatus} to{' '}
                    <StatusBadge status={e.toStatus} />
                  </>
                ) : (
                  <>
                    created the job · <StatusBadge status={e.toStatus} />
                  </>
                )}
                {describe(e.metadata).map(line => (
                  <div key={line} className="muted small">
                    {line}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Notes targetType="job" targetId={job.id} />

      <section className="panel">
        <h2>Money records</h2>
        <Records
          title="Charges (what the customer owes)"
          rows={data.charges.map(c => [when(c.createdAt), humanize(c.purpose), c.description, ksh(c.amount)])}
        />
        <Records
          title="Payments (M-Pesa into escrow)"
          rows={data.payments.map(p => [
            when(p.createdAt),
            humanize(p.purpose),
            `${humanize(p.status)}${p.failureReason ? ` (${humanize(p.failureReason)})` : ''}`,
            p.receiptNumber ?? p.phone,
            p.partsAmount ? `${ksh(p.amount)} (parts ${ksh(p.partsAmount)})` : ksh(p.amount),
          ])}
        />
        <Records
          title="Refunds"
          rows={data.refunds.map(r => [when(r.createdAt), humanize(r.reason), humanize(r.status), ksh(r.amount)])}
        />
        <Records
          title="Payouts to mechanic"
          rows={data.releases.map(r => [
            when(r.createdAt),
            r.lines.map(l => humanize(l.purpose)).join(' + '),
            `gross ${ksh(r.gross)}`,
            `commission ${ksh(r.commission)}`,
            ksh(r.net),
          ])}
        />
      </section>

      {data.quotes.length > 0 && (
        <section className="panel">
          <h2>Quotes</h2>
          {data.quotes.map(quote => (
            <div key={quote.id} className="quote">
              <p>
                <strong>
                  {humanize(quote.kind)} v{quote.version}
                </strong>{' '}
                · {humanize(quote.status)} · by {quote.issuedBy === 'FUNDI_X' ? 'Fundi-X' : 'mechanic'}
                {quote.note && <span className="muted"> · {quote.note}</span>}
              </p>
              <table>
                <tbody>
                  {quote.items.map(item => (
                    <tr key={item.id}>
                      <td className="mono small">{item.serviceCode}</td>
                      <td>{item.description}</td>
                      <td className="num">
                        {item.quantity} × {ksh(item.unitPrice)}
                      </td>
                      <td className="num">{ksh(item.total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3}>
                      <strong>Total</strong>
                    </td>
                    <td className="num">
                      <strong>{ksh(quote.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <h2>Timers</h2>
        {data.timers.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <table>
            <tbody>
              {data.timers.map(t => (
                <tr key={t.id} className={t.status === 'FAILED' ? 'warn' : ''}>
                  <td>{humanize(t.kind)}</td>
                  <td>{humanize(t.status)}</td>
                  <td className="nowrap">due {when(t.dueAt)}</td>
                  <td className="muted small">{t.lastError ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Records({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="records">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted small">None.</p>
      ) : (
        <table>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j} className={j === cells.length - 1 ? 'num' : j === 0 ? 'nowrap muted small' : ''}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
