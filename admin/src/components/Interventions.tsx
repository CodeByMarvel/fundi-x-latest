import { useState } from 'react';
import { api, ApiError, type JobDetail, type JobStatus, type Permission } from '../api';
import { ksh } from '../format';
import { ReasonForm } from './ReasonForm';

/** Mirrors server/src/jobs/support.ts. */
const CANCELLABLE: JobStatus[] = [
  'CALL_OUT_PAYMENT_PENDING',
  'SEARCHING',
  'OFFERED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_SENT',
  'SERVICE_PAYMENT_PENDING',
  'IN_PROGRESS',
];
const REASSIGNABLE: JobStatus[] = ['ACCEPTED', 'EN_ROUTE'];

type Action = 'cancel' | 'reassign' | 'dispute';

/**
 * Stepping in on a job (docs/admin-portal.md §3.6). Only the actions the
 * job's status and the staff member's role allow are offered, and each
 * asks why. The server checks both again.
 */
export function Interventions({
  data,
  can,
  onDone,
}: {
  data: JobDetail;
  can: (p: Permission) => boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<Action | null>(null);
  const { job } = data;
  const disputed = job.status === 'DISPUTED' && can('disputes.resolve');
  const cancellable = CANCELLABLE.includes(job.status) && can('jobs.cancel');
  const reassignable = REASSIGNABLE.includes(job.status) && !!data.provider && can('jobs.cancel');

  if (!disputed && !cancellable && !reassignable) {
    return null;
  }
  const done = () => {
    setOpen(null);
    onDone();
  };

  return (
    <section className="panel intervene">
      <h2>Step in</h2>
      <p className="muted small">
        Each action goes through the same rules as the apps, is recorded on the job's timeline as
        Fundi-X with your reason, and lands in the audit log.
      </p>
      {disputed && job.dispute && (
        <div className="notice error">
          <strong>The customer reported a problem:</strong> “{job.dispute.reason}”
        </div>
      )}
      {!open && (
        <div className="row">
          {disputed && (
            <button className="primary" onClick={() => setOpen('dispute')}>
              Resolve dispute…
            </button>
          )}
          {reassignable && (
            <button className="secondary" onClick={() => setOpen('reassign')}>
              Find another mechanic…
            </button>
          )}
          {cancellable && (
            <button className="secondary danger" onClick={() => setOpen('cancel')}>
              Cancel and refund…
            </button>
          )}
        </div>
      )}
      {open === 'cancel' && (
        <ReasonForm
          prompt={`Cancel this job. ${ksh(data.money.heldInEscrow)} still held goes back to the customer. Why?`}
          confirmLabel="Cancel the job"
          onCancel={() => setOpen(null)}
          onSubmit={reason => api(`/jobs/${job.id}/cancel`, 'POST', { reason }).then(done)}
        />
      )}
      {open === 'reassign' && (
        <ReasonForm
          prompt={`Take the job off ${data.provider?.name ?? 'the mechanic'} and search again. The call-out stays held. Why?`}
          confirmLabel="Search again"
          onCancel={() => setOpen(null)}
          onSubmit={reason => api(`/jobs/${job.id}/reassign`, 'POST', { reason }).then(done)}
        />
      )}
      {open === 'dispute' && (
        <ResolveDispute held={data.money.heldInEscrow} jobId={job.id} onCancel={() => setOpen(null)} onDone={done} />
      )}
    </section>
  );
}

type Outcome = 'REWORK' | 'UPHOLD_PROVIDER' | 'SPLIT';

const OUTCOMES: { id: Outcome; label: string; help: string }[] = [
  { id: 'REWORK', label: 'Mechanic fixes it', help: 'Back to work, at no extra cost. Counts against their reliability.' },
  { id: 'UPHOLD_PROVIDER', label: 'Work was fine', help: 'The job completes and the money held is paid to the mechanic.' },
  { id: 'SPLIT', label: 'Divide the money', help: 'The job closes; you decide how much goes back to the customer.' },
];

function ResolveDispute({
  held,
  jobId,
  onCancel,
  onDone,
}: {
  held: number;
  jobId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>('REWORK');
  const [refundShillings, setRefundShillings] = useState(String(held / 200));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refund = Math.round(Number(refundShillings || 0)) * 100;
  const splitOk = outcome !== 'SPLIT' || (refund >= 0 && refund <= held);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/jobs/${jobId}/resolve-dispute`, 'POST', {
        outcome,
        reason: reason.trim(),
        ...(outcome === 'SPLIT' && { customerRefund: refund, providerPayout: held - refund }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
      setBusy(false);
    }
  }

  return (
    <form
      className="reason-form"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="small">
        Held for this job: <strong>{ksh(held)}</strong> (call-out and labour; parts money already went to the
        mechanic).
      </p>
      <div className="choices">
        {OUTCOMES.map(o => (
          <label key={o.id} className={o.id === outcome ? 'choice selected' : 'choice'}>
            <input type="radio" name="outcome" checked={o.id === outcome} onChange={() => setOutcome(o.id)} />
            <span>
              <strong>{o.label}</strong>
              <span className="muted small"> {o.help}</span>
            </span>
          </label>
        ))}
      </div>
      {outcome === 'SPLIT' && (
        <div className="row">
          <label className="money-input">
            <span>Refund KSh</span>
            <input
              inputMode="numeric"
              value={refundShillings}
              onChange={e => setRefundShillings(e.target.value.replace(/[^\d]/g, ''))}
              aria-label="Refund to the customer in shillings"
            />
          </label>
          <span className="small">
            → mechanic gets {splitOk ? ksh(held - refund) : '—'} before commission
          </span>
        </div>
      )}
      <label>
        <span className="small">Why? The customer and mechanic may be told this.</span>
        <textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || reason.trim().length < 5 || !splitOk}>
          {busy ? 'Saving…' : 'Save decision'}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Back
        </button>
        {!splitOk && <span className="error small">The refund can't be more than what's held.</span>}
        {error && <span className="error small">{error}</span>}
      </div>
    </form>
  );
}
