import { useCallback, useEffect, useState } from 'react';
import { useEvery } from '../useEvery';
import { api, type Permission } from '../api';
import { TRANSFER_STATUS, TransferRow } from '../components/TransferRow';
import { JobLink } from '../components/JobLink';
import { StatusBadge } from '../components/StatusBadge';
import { ago, humanize, ksh, when } from '../format';
import { href } from '../route';
import type {
  Books,
  EscrowRow,
  FinanceSummary,
  PaymentRow,
  ProviderEarnings,
  RefundRow,
  ReleaseRow,
  Transfer,
  TransferStatus,
} from '../types';

type Tab = 'transfers' | 'payments' | 'refunds' | 'payouts' | 'escrow' | 'mechanics';

const TABS: { id: Tab; label: string }[] = [
  { id: 'transfers', label: 'M-Pesa out' },
  { id: 'payments', label: 'Payments in' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'escrow', label: 'Held now' },
  { id: 'mechanics', label: 'By mechanic' },
];

const PURPOSE: Record<string, string> = {
  CALL_OUT: 'Call-out',
  SERVICE: 'Labour & work',
  PARTS: 'Parts',
};

/**
 * Finance (docs/admin-portal.md §3.8): read-only, calculated from the
 * payment, refund and payout records. Sending refunds and payouts through
 * M-Pesa arrives with Daraja; until then they are recorded, not sent.
 */
export function Finance({ can }: { can: (p: Permission) => boolean }) {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('transfers');

  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    api<FinanceSummary>(`/finance/summary?from=${day(from)}&to=${day(to)}`).then(setSummary, err =>
      setError(err.message),
    );
  }, [days]);

  const moneyIn = summary?.moneyIn.reduce((s, r) => s + r.amount, 0) ?? 0;
  const earned = summary?.earnings.reduce((s, r) => s + r.commission, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Finance</h1>
        <div className="tabs">
          {[7, 30, 90].map(d => (
            <button key={d} className={d === days ? 'tab active' : 'tab'} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        Payouts and refunds go out through M-Pesa B2C automatically. “M-Pesa out” shows each one
        until Safaricom confirms it arrived; anything that failed waits for you there.
      </p>
      {error && <p className="notice error">{error}</p>}
      {summary && (
        <>
          <div className="cards">
            <div className="card">
              <h3>Paid in · {days} days</h3>
              <p className="stat">{ksh(moneyIn)}</p>
            </div>
            <div className="card">
              <h3>Fundi-X earned · {days} days</h3>
              <p className="stat good">{ksh(earned)}</p>
              <span className="muted small">commission on money paid out</span>
            </div>
            <div className="card">
              <h3>Refunded · {days} days</h3>
              <p className="stat">{ksh(summary.refunds.amount)}</p>
              <span className="muted small">{summary.refunds.count} refunds</span>
            </div>
            <a className="card clickable" onClick={() => setTab('escrow')}>
              <h3>Held in escrow now</h3>
              <p className="stat">{ksh(summary.now.heldInEscrow.amount)}</p>
              <span className="muted small">{summary.now.heldInEscrow.jobs} jobs</span>
            </a>
            <a className="card clickable" onClick={() => setTab('refunds')}>
              <h3>Refunds to send</h3>
              <p className={`stat ${summary.now.refundsWaiting.count ? 'warn' : ''}`}>
                {ksh(summary.now.refundsWaiting.amount)}
              </p>
              <span className="muted small">{summary.now.refundsWaiting.count} waiting for M-Pesa</span>
            </a>
            <a className="card clickable" onClick={() => setTab('mechanics')}>
              <h3>Payouts recorded</h3>
              <p className="stat">{ksh(summary.now.payoutsRecorded.amount)}</p>
              <span className="muted small">{summary.now.payoutsRecorded.count} payouts, all time</span>
            </a>
          </div>

          <BooksPanel />

          <DailyChart days={summary.byDay} />

          <section className="panel">
            <h2>Where the money came from, and what Fundi-X kept</h2>
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th className="num">Paid in</th>
                  <th className="num">Paid out to mechanics (gross)</th>
                  <th className="num">Fundi-X commission</th>
                </tr>
              </thead>
              <tbody>
                {['CALL_OUT', 'SERVICE', 'PARTS'].map(purpose => {
                  const inRow = summary.moneyIn.find(r => r.purpose === purpose);
                  const paidIn =
                    purpose === 'PARTS'
                      ? summary.moneyIn.reduce((s, r) => s + r.parts, 0)
                      : purpose === 'SERVICE'
                        ? (inRow?.amount ?? 0) - (inRow?.parts ?? 0)
                        : (inRow?.amount ?? 0);
                  const out = summary.earnings.find(r => r.purpose === purpose);
                  return (
                    <tr key={purpose}>
                      <td>{PURPOSE[purpose]}</td>
                      <td className="num">{ksh(paidIn)}</td>
                      <td className="num">{ksh(out?.gross ?? 0)}</td>
                      <td className="num">{ksh(out?.commission ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              Paid in counts M-Pesa confirmations in the period; commission counts payouts in the
              period, so the two don't line up job by job.
            </p>
          </section>
        </>
      )}

      <div className="tabs section-tabs">
        {TABS.map(t => (
          <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'transfers' && <Transfers canAct={can('money.refund')} />}
      {tab === 'payments' && <Payments />}
      {tab === 'refunds' && <Refunds />}
      {tab === 'payouts' && <Payouts />}
      {tab === 'escrow' && <Escrow />}
      {tab === 'mechanics' && <ByMechanic />}
    </>
  );
}

/**
 * The double-entry books (docs/ledger.md): where every shilling Fundi-X
 * holds is right now, and the check that the books agree with the
 * payment records.
 */
function BooksPanel() {
  const [books, setBooks] = useState<Books | null>(null);
  useEffect(() => {
    api<Books>('/finance/books').then(setBooks, () => {});
  }, []);
  if (!books) {
    return null;
  }
  const { totals, check } = books;
  const problems = check.escrowMismatches.length + check.missingEntries.length + check.overdrawn.length;
  return (
    <section className={check.ok ? 'panel' : 'panel alert-panel'}>
      <div className="panel-head">
        <h2>Books</h2>
        <span className={check.ok ? 'badge done' : 'badge bad'}>
          {check.ok ? '✓ Balanced, and matches the records' : `${problems} problem${problems === 1 ? '' : 's'} found`}
        </span>
      </div>
      <table>
        <tbody>
          <tr>
            <td>Money at Safaricom (M-Pesa)</td>
            <td className="num">
              <strong>{ksh(totals.mpesa)}</strong>
            </td>
          </tr>
          <tr>
            <td className="muted">… held for jobs in progress (escrow)</td>
            <td className="num">{ksh(totals.escrow)}</td>
          </tr>
          <tr>
            <td className="muted">… earned by mechanics, not yet sent</td>
            <td className="num">{ksh(totals.owedToMechanics)}</td>
          </tr>
          <tr>
            <td className="muted">… refunds owed to customers, not yet sent</td>
            <td className="num">{ksh(totals.owedToCustomers)}</td>
          </tr>
          <tr>
            <td className="muted">… Fundi-X commission</td>
            <td className="num">{ksh(totals.revenue)}</td>
          </tr>
        </tbody>
      </table>
      {!check.ok && (
        <div className="notice error">
          <p>
            <strong>The books disagree with the records.</strong> This is a bug to investigate,
            never something to fix by editing rows.
          </p>
          {check.total !== 0 && <p>All entries together are off by {ksh(check.total)}.</p>}
          {check.escrowMismatches.map(m => (
            <p key={m.jobId}>
              Job <JobLink id={m.jobId} />: records say {ksh(m.records)} held, books say {ksh(m.books)}.
            </p>
          ))}
          {check.missingEntries.map(m => (
            <p key={m.id}>
              A {m.kind} (<span className="mono">{m.id}</span>) has no ledger entry.
            </p>
          ))}
          {check.overdrawn.map(m => (
            <p key={m.account}>
              <span className="mono">{m.account}</span> was paid {ksh(m.balance)} more than it was owed.
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Money paid in per day: one series, so the title names it and there's no
 * legend. Hover a day for its numbers; the same numbers are in the table.
 */
function DailyChart({ days }: { days: FinanceSummary['byDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...days.map(d => d.moneyIn), 0);
  const top = niceCeiling(max);
  const width = 720;
  const height = 180;
  const left = 56;
  const bottom = 22;
  const plotW = width - left - 8;
  const plotH = height - bottom - 8;
  const band = plotW / Math.max(days.length, 1);
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (v: number) => 8 + plotH - (top ? (v / top) * plotH : 0);
  const label = (day: string) =>
    new Date(`${day}T12:00:00+03:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  const shown = hover !== null ? days[hover] : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Paid in per day</h2>
        <button className="link" onClick={() => setAsTable(t => !t)}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Paid in</th>
                <th className="num">Fundi-X commission</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map(d => (
                <tr key={d.day}>
                  <td>{label(d.day)}</td>
                  <td className="num">{ksh(d.moneyIn)}</td>
                  <td className="num">{ksh(d.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Money paid in per day">
            {[0, 0.5, 1].map(f => (
              <g key={f}>
                <line className="grid" x1={left} x2={width - 8} y1={y(top * f)} y2={y(top * f)} />
                <text className="axis" x={left - 6} y={y(top * f) + 4} textAnchor="end">
                  {compact(top * f)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = left + i * band + (band - barW) / 2;
              const h = Math.max(0, y(0) - y(d.moneyIn));
              return (
                <g key={d.day} onMouseEnter={() => setHover(i)}>
                  {/* Hit area: the whole day's column, bigger than the bar. */}
                  <rect x={left + i * band} y={8} width={band} height={plotH} fill="transparent" />
                  {h > 0 && (
                    <path
                      className={hover === i ? 'bar active' : 'bar'}
                      d={roundedTop(x, y(d.moneyIn), barW, h, Math.min(4, h, barW / 2))}
                    />
                  )}
                </g>
              );
            })}
            {[0, Math.floor((days.length - 1) / 2), days.length - 1].map(i =>
              days[i] ? (
                <text key={i} className="axis" x={left + i * band + band / 2} y={height - 6} textAnchor="middle">
                  {label(days[i].day)}
                </text>
              ) : null,
            )}
          </svg>
          {shown && hover !== null && (
            <div
              className="chart-tip"
              style={{ left: `${((left + hover * band + band / 2) / width) * 100}%` }}
            >
              <strong>{label(shown.day)}</strong>
              <div>Paid in {ksh(shown.moneyIn)}</div>
              <div className="muted">Commission {ksh(shown.commission)}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A bar with 4px rounded top corners, square at the baseline. */
function roundedTop(x: number, top: number, w: number, h: number, r: number) {
  return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`;
}

/** 0 / 5K / 1.2M in shillings, from cents. */
function compact(cents: number) {
  const s = cents / 100;
  if (s >= 1_000_000) {
    return `${+(s / 1_000_000).toFixed(1)}M`;
  }
  if (s >= 1000) {
    return `${+(s / 1000).toFixed(1)}K`;
  }
  return String(Math.round(s));
}

/** A round number at or above the largest value, so the axis reads cleanly. */
function niceCeiling(cents: number) {
  if (cents <= 0) {
    return 100_000;
  }
  const step = 10 ** Math.floor(Math.log10(cents));
  return Math.ceil(cents / step) * step;
}

function useList<T>(path: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    api<T[]>(path).then(setRows, err => setError(err.message));
  }, [path]);
  return { rows, error };
}

function ListState({ rows, error, empty }: { rows: unknown[] | null; error: string | null; empty: string }) {
  if (error) {
    return <p className="notice error">{error}</p>;
  }
  if (!rows) {
    return <p className="muted">Loading…</p>;
  }
  return rows.length === 0 ? <p className="muted">{empty}</p> : null;
}

function Transfers({ canAct }: { canAct: boolean }) {
  const [status, setStatus] = useState<'' | TransferStatus>('');
  const [rows, setRows] = useState<Transfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Transfer[]>(`/finance/transfers${status ? `?status=${status}` : ''}`).then(setRows, err => setError(err.message));
  }, [status]);
  useEffect(load, [load]);
  useEvery(load, 15_000);
  return (
    <>
      <div className="filters">
        <select value={status} onChange={e => setStatus(e.target.value as '' | TransferStatus)} aria-label="Status">
          <option value="">Problems first, then newest</option>
          {(Object.keys(TRANSFER_STATUS) as TransferStatus[]).map(s => (
            <option key={s} value={s}>
              {TRANSFER_STATUS[s].label}
            </option>
          ))}
        </select>
      </div>
      <ListState rows={rows} error={error} empty="Nothing sent yet." />
      {rows?.map(t => <TransferRow key={t.id} transfer={t} canAct={canAct} onDone={load} />)}
    </>
  );
}

function Payments() {
  const { rows, error } = useList<PaymentRow>('/finance/transactions?type=payment&limit=100');
  return (
    <>
      <ListState rows={rows} error={error} empty="No payments yet." />
      {!!rows?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Job</th>
                <th>For</th>
                <th>Status</th>
                <th>M-Pesa</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className={p.status === 'FAILED' ? 'warn' : ''}>
                  <td className="nowrap">{ago(p.createdAt)}</td>
                  <td>
                    <JobLink id={p.jobId} />
                  </td>
                  <td>
                    {PURPOSE[p.purpose] ?? p.purpose}
                    {p.partsAmount > 0 && <div className="muted small">incl. parts {ksh(p.partsAmount)}</div>}
                  </td>
                  <td>
                    {humanize(p.status)}
                    {p.failureReason && <div className="muted small">{humanize(p.failureReason)}</div>}
                  </td>
                  <td className="mono small">{p.receiptNumber ?? p.phone}</td>
                  <td className="num">{ksh(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Refunds() {
  const { rows, error } = useList<RefundRow>('/finance/transactions?type=refund&limit=100');
  return (
    <>
      <ListState rows={rows} error={error} empty="No refunds yet." />
      {!!rows?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Job</th>
                <th>Why</th>
                <th>Status</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{ago(r.createdAt)}</td>
                  <td>
                    <JobLink id={r.jobId} />
                  </td>
                  <td>{humanize(r.reason)}</td>
                  <td>
                    <span className={r.status === 'PENDING' ? 'badge wait' : 'badge done'}>
                      {r.status === 'PENDING' ? 'To send' : 'Sent'}
                    </span>
                  </td>
                  <td className="num">{ksh(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Payouts() {
  const { rows, error } = useList<ReleaseRow>('/finance/transactions?type=release&limit=100');
  return (
    <>
      <ListState rows={rows} error={error} empty="No payouts yet." />
      {!!rows?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Job</th>
                <th>Mechanic</th>
                <th>For</th>
                <th className="num">Gross</th>
                <th className="num">Commission</th>
                <th className="num">To mechanic</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{ago(r.createdAt)}</td>
                  <td>
                    <JobLink id={r.jobId} />
                  </td>
                  <td>
                    {r.providerId ? <a href={href({ page: 'person', id: r.providerId })}>{r.providerName ?? r.providerId}</a> : '—'}
                  </td>
                  <td>{r.lines.map(l => PURPOSE[l.purpose] ?? l.purpose).join(' + ')}</td>
                  <td className="num">{ksh(r.gross)}</td>
                  <td className="num">{ksh(r.commission)}</td>
                  <td className="num">
                    <strong>{ksh(r.net)}</strong>
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

function Escrow() {
  const { rows, error } = useList<EscrowRow>('/finance/escrow');
  return (
    <>
      <p className="muted">Oldest first: money held a long time on a finished-looking job needs a look.</p>
      <ListState rows={rows} error={error} empty="Nothing held. ✓" />
      {!!rows?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Booked</th>
                <th className="num">Held</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(j => (
                <tr key={j.id}>
                  <td>
                    <JobLink id={j.id} />
                    <div className="muted small">{humanize(j.request.categoryId)}</div>
                  </td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td>{j.customer?.name ?? '—'}</td>
                  <td className="nowrap" title={when(j.createdAt)}>
                    {ago(j.createdAt)}
                  </td>
                  <td className="num">{ksh(j.heldInEscrow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ByMechanic() {
  const { rows, error } = useList<ProviderEarnings>('/finance/providers');
  return (
    <>
      <ListState rows={rows} error={error} empty="No payouts yet." />
      {!!rows?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mechanic</th>
                <th>M-Pesa for payouts</th>
                <th className="num">Payouts</th>
                <th className="num">Gross</th>
                <th className="num">Commission</th>
                <th className="num">To mechanic</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td>
                    <a href={href({ page: 'person', id: p.id })}>{p.name}</a>
                  </td>
                  <td className="mono">{p.payoutPhone}</td>
                  <td className="num">{p.payouts}</td>
                  <td className="num">{ksh(p.gross)}</td>
                  <td className="num">{ksh(p.commission)}</td>
                  <td className="num">
                    <strong>{ksh(p.net)}</strong>
                  </td>
                  <td className="nowrap">{p.lastAt ? ago(p.lastAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
