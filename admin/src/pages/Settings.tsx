import { useEffect, useState } from 'react';
import { api, ApiError, type SettingRow } from '../api';
import { ksh, SETTINGS, when } from '../format';

export function Settings() {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<SettingRow[]>('/settings').then(setRows, err => setError(err.message));
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">
        Business values that change without an app update. Every change is
        recorded in the audit log with its old and new value.
      </p>
      {error && <p className="notice error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.map(row => (
        <MoneySetting key={row.key} row={row} onSaved={load} />
      ))}
    </>
  );
}

/** Edited in shillings; stored in cents. */
function MoneySetting({ row, onSaved }: { row: SettingRow; onSaved: () => void }) {
  const meta = SETTINGS[row.key];
  const current = (row.value as number) / 100;
  const [draft, setDraft] = useState(String(current));
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => setDraft(String(current)), [current]);

  const shillings = Number(draft);
  const changed = draft.trim() !== '' && shillings !== current;

  async function save() {
    if (!Number.isFinite(shillings)) {
      setStatus({ kind: 'error', message: 'Enter an amount in shillings.' });
      return;
    }
    const sure = window.confirm(
      `Change ${meta?.label ?? row.key} from ${ksh(current * 100)} to ${ksh(shillings * 100)}?`,
    );
    if (!sure) {
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      await api(`/settings/${row.key}`, 'PUT', { value: Math.round(shillings * 100) });
      setStatus({ kind: 'saved' });
      onSaved();
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save.',
      });
    }
  }

  return (
    <section className="panel setting">
      <div>
        <h2>{meta?.label ?? row.key}</h2>
        {meta && <p className="muted">{meta.help}</p>}
        <p className="muted small">
          Default {ksh(row.default as number)}
          {row.updatedAt ? ` · last changed ${when(row.updatedAt)}` : ' · never changed'}
        </p>
      </div>
      <form
        className="setting-form"
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
      >
        <label className="money-input">
          <span>KSh</span>
          <input
            inputMode="numeric"
            value={draft}
            onChange={e => {
              setDraft(e.target.value.replace(/[^\d]/g, ''));
              setStatus({ kind: 'idle' });
            }}
            aria-label={`${meta?.label ?? row.key} in shillings`}
          />
        </label>
        <button className="primary" disabled={!changed || status.kind === 'saving'}>
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status.kind === 'saved' && <span className="ok small">Saved</span>}
        {status.kind === 'error' && <span className="error small">{status.message}</span>}
      </form>
    </section>
  );
}
