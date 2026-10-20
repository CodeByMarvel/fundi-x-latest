import { useState } from 'react';
import { api, ApiError } from '../api';
import { ago, ksh, when } from '../format';
import type { Transfer, TransferStatus } from '../types';
import { JobLink } from './JobLink';
import { ReasonForm } from './ReasonForm';

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; badge: string }> = {
  QUEUED: { label: 'Waiting to send', badge: 'badge wait' },
  SENDING: { label: 'Sending', badge: 'badge active' },
  SENT: { label: 'Sent, awaiting M-Pesa', badge: 'badge active' },
  SUCCESS: { label: 'Received', badge: 'badge done' },
  FAILED: { label: 'Failed: needs you', badge: 'badge bad' },
};

/**
 * One M-Pesa B2C transfer (a payout or a refund). A failed one can be sent
 * again once the cause is fixed, or marked sent if the M-Pesa statement
 * shows it arrived (e.g. after an interrupted send).
 */
export function TransferRow({
  transfer: t,
  canAct,
  showJob = true,
  onDone,
}: {
  transfer: Transfer;
  canAct: boolean;
  showJob?: boolean;
  onDone: () => void;
}) {
  const [action, setAction] = useState<'retry' | 'mark' | null>(null);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const status = TRANSFER_STATUS[t.status];

  return (
    <div className={`item ${t.status === 'FAILED' ? 'bad' : t.status === 'SUCCESS' ? '' : 'warn'}`}>
      <div className="item-head">
        <div>
          <strong>
            {t.kind === 'PAYOUT' ? 'Payout' : 'Refund'} {ksh(t.amount)}
          </strong>{' '}
          to {t.recipientName ?? 'recipient'} <span className="mono small">{t.phone}</span>{' '}
          <span className={status.badge}>{status.label}</span>
          <div className="muted small">
            {showJob && (
              <>
                job <JobLink id={t.jobId} /> ·{' '}
              </>
            )}
            created {ago(t.createdAt)}
            {t.attempts > 0 && ` · ${t.attempts} ${t.attempts === 1 ? 'try' : 'tries'}`}
            {t.receiptNumber && (
              <>
                {' '}
                · M-Pesa <span className="mono">{t.receiptNumber}</span>
              </>
            )}
            {t.completedAt && ` · received ${when(t.completedAt)}`}
            {t.status === 'QUEUED' && t.attempts > 0 && ` · next try ${ago(t.nextAttemptAt)}`}
          </div>
          {t.lastError && <div className="small error">{t.lastError}</div>}
        </div>
        {canAct && t.status === 'FAILED' && !action && (
          <div className="row">
            <button className="secondary" onClick={() => setAction('retry')}>
              Send again
            </button>
            <button className="link" onClick={() => setAction('mark')}>
              It arrived…
            </button>
          </div>
        )}
      </div>
      {action === 'retry' && (
        <ReasonForm
          prompt="Check the M-Pesa statement first: if it already arrived, use “It arrived” instead. Why send again?"
          confirmLabel="Send again"
          onCancel={() => setAction(null)}
          onSubmit={reason => api(`/transfers/${t.id}/retry`, 'POST', { reason }).then(onDone)}
        />
      )}
      {action === 'mark' && (
        <div className="reason-form">
          <label>
            <span className="small">M-Pesa transaction code from the statement</span>
            <input
              className="search mono"
              value={receipt}
              maxLength={10}
              placeholder="e.g. SKL9X2ABCD"
              onChange={e => setReceipt(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          {error && <span className="error small">{error}</span>}
          <ReasonForm
            prompt="Record this transfer as received. Why are you sure?"
            confirmLabel="Record as received"
            onCancel={() => setAction(null)}
            onSubmit={async reason => {
              if (!/^[A-Z0-9]{10}$/.test(receipt)) {
                setError('An M-Pesa code is 10 letters and digits.');
                throw new ApiError(400, 'invalid', 'Enter the 10-character M-Pesa code.');
              }
              await api(`/transfers/${t.id}/mark-sent`, 'POST', { reason, receipt });
              onDone();
            }}
          />
        </div>
      )}
    </div>
  );
}
