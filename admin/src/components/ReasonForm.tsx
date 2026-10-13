import { useState } from 'react';
import { ApiError } from '../api';

/**
 * Every intervention asks why (docs/admin-portal.md §1). The reason is
 * saved in the audit log next to who did it and when.
 */
export function ReasonForm({
  prompt,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  prompt: string;
  confirmLabel: string;
  onSubmit: (reason: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = reason.trim().length >= 5;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
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
      <label>
        <span className="small">{prompt}</span>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Reason (kept in the audit log)"
          autoFocus
        />
      </label>
      <div className="row">
        <button className="primary" disabled={!ready || busy}>
          {busy ? 'Saving…' : confirmLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {error && <span className="error small">{error}</span>}
      </div>
    </form>
  );
}
