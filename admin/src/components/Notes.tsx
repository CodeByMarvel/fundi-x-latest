import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { when } from '../format';
import type { Note } from '../types';

/**
 * Staff notes on a job or a person, newest first, so whoever picks the
 * case up next sees the story. Notes are only ever added.
 */
export function Notes({ targetType, targetId }: { targetType: 'job' | 'user'; targetId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Note[]>(`/notes?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`).then(
        setNotes,
        err => setError(err.message),
      ),
    [targetType, targetId],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api('/notes', 'POST', { targetType, targetId, body: draft.trim() });
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the note.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Notes</h2>
      <form
        className="reason-form"
        onSubmit={e => {
          e.preventDefault();
          add();
        }}
      >
        <textarea
          rows={2}
          maxLength={2000}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="What happened, who you spoke to, what's next…"
          aria-label="New note"
        />
        <div className="row">
          <button className="primary" disabled={!draft.trim() || busy}>
            {busy ? 'Saving…' : 'Add note'}
          </button>
          {error && <span className="error small">{error}</span>}
        </div>
      </form>
      {notes?.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul className="activity">
        {notes?.map(n => (
          <li key={n.id}>
            <span className="note-body">{n.body}</span>
            <span className="muted small">
              {n.staffEmail ?? '—'} · {when(n.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
