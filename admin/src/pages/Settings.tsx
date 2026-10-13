import { useEffect, useState } from 'react';
import { api, type SettingRow } from '../api';
import { ReasonForm } from '../components/ReasonForm';
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
        Business values that change without an app update. Every change needs
        a reason and is recorded in the audit log with its old and new value.
      </p>
      {error && <p className="notice error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.map(row => (
        <MoneySetting key={row.key} row={row} onSaved={load} />
      ))}
    </>
  );
}

/** Edited in shillings; stored in cents. Saving asks why. */
function MoneySetting({ row, onSaved }: { row: SettingRow; onSaved: () => void }) {
  const meta = SETTINGS[row.key];
  const current = (row.value as number) / 100;
  const [draft, setDraft] = useState(String(current));
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(String(current)), [current]);

  const shillings = Number(draft);
  const changed = draft.trim() !== '' && Number.isFinite(shillings) && shillings !== current;

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
          setConfirming(true);
        }}
      >
        <label className="money-input">
          <span>KSh</span>
          <input
            inputMode="numeric"
            value={draft}
            disabled={confirming}
            onChange={e => {
              setDraft(e.target.value.replace(/[^\d]/g, ''));
              setSaved(false);
            }}
            aria-label={`${meta?.label ?? row.key} in shillings`}
          />
        </label>
        {!confirming && (
          <button className="primary" disabled={!changed}>
            Save
          </button>
        )}
        {saved && <span className="ok small">Saved</span>}
      </form>
      {confirming && (
        <div className="setting-confirm">
          <ReasonForm
            prompt={`Change ${meta?.label.toLowerCase() ?? row.key} from ${ksh(current * 100)} to ${ksh(shillings * 100)}. Why?`}
            confirmLabel="Change it"
            onCancel={() => {
              setConfirming(false);
              setDraft(String(current));
            }}
            onSubmit={async reason => {
              await api(`/settings/${row.key}`, 'PUT', {
                value: Math.round(shillings * 100),
                reason,
              });
              setConfirming(false);
              setSaved(true);
              onSaved();
            }}
          />
        </div>
      )}
    </section>
  );
}
