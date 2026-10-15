import { useEffect, useState } from 'react';
import { api, type SettingRow } from '../api';
import { ReasonForm } from '../components/ReasonForm';
import { SETTINGS, settingValue, when } from '../format';

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
        <NumberSetting key={row.key} row={row} onSaved={load} />
      ))}
    </>
  );
}

/**
 * One whole-number setting. Money is edited in shillings and stored in
 * cents; everything else is stored as typed. Saving asks why.
 */
function NumberSetting({ row, onSaved }: { row: SettingRow; onSaved: () => void }) {
  const meta = SETTINGS[row.key];
  const isMoney = meta?.kind !== 'number';
  const scale = isMoney ? 100 : 1;
  const current = (row.value as number) / scale;
  const [draft, setDraft] = useState(String(current));
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(String(current)), [current]);

  const entered = Number(draft);
  const changed = draft.trim() !== '' && Number.isFinite(entered) && entered !== current;
  const label = meta?.label ?? row.key;
  const show = (value: number) => settingValue(row.key, value);

  return (
    <section className="panel setting">
      <div>
        <h2>{label}</h2>
        {meta && <p className="muted">{meta.help}</p>}
        <p className="muted small">
          Default {show(row.default as number)}
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
          {isMoney && <span>KSh</span>}
          <input
            inputMode="numeric"
            value={draft}
            disabled={confirming}
            onChange={e => {
              setDraft(e.target.value.replace(/[^\d]/g, ''));
              setSaved(false);
            }}
            aria-label={isMoney ? `${label} in shillings` : `${label} in ${meta.unit}`}
          />
          {meta?.kind === 'number' && <span>{meta.unit}</span>}
        </label>
        {!confirming && (
          <button className="primary" disabled={!changed}>
            Save
          </button>
        )}
        {saved && <span className="ok small">Saved</span>}
      </form>
      {meta?.kind === 'number' && (
        <p className="muted small">
          Allowed: {meta.min} to {meta.max} {meta.unit}.
        </p>
      )}
      {confirming && (
        <div className="setting-confirm">
          <ReasonForm
            prompt={`Change ${label.toLowerCase()} from ${show(current * scale)} to ${show(entered * scale)}. Why?`}
            confirmLabel="Change it"
            onCancel={() => {
              setConfirming(false);
              setDraft(String(current));
            }}
            onSubmit={async reason => {
              await api(`/settings/${row.key}`, 'PUT', {
                value: Math.round(entered * scale),
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
