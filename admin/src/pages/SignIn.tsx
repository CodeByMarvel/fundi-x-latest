import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Me } from '../api';
import { loadGoogle } from '../google';

type State =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'not_configured' }
  | { kind: 'error'; message: string };

/** Why sign-in failed, in words the person signing in can act on. */
function explain(err: unknown) {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return "This Google account isn't allowed into the Fundi-X admin console.";
    }
    if (err.status === 401) {
      return 'Google sign-in failed. Please try again.';
    }
    if (err.code === 'unreachable') {
      return "Can't reach the Fundi-X server. Is it running?";
    }
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const button = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { googleClientId } = await api<{ googleClientId: string | null }>(
          '/config',
        );
        if (!googleClientId) {
          setState({ kind: 'not_configured' });
          return;
        }
        const google = await loadGoogle();
        if (cancelled || !button.current) {
          return;
        }
        google.accounts.id.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          callback: async ({ credential }) => {
            setRefused(null);
            try {
              onSignedIn(await api<Me>('/auth/google', 'POST', { credential }));
            } catch (err) {
              setRefused(explain(err));
            }
          },
        });
        google.accounts.id.renderButton(button.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: 280,
        });
        setState({ kind: 'ready' });
      } catch (err) {
        if (!cancelled) {
          setState({ kind: 'error', message: explain(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);

  return (
    <main className="signin">
      <div className="signin-card">
        <img src="/icon-192.png" alt="" className="signin-logo" />
        <h1>Fundi-X Admin</h1>
        <p className="muted">Staff only. Sign in with your Google account.</p>

        <div ref={button} className="google-button" hidden={state.kind !== 'ready'} />
        {state.kind === 'loading' && <p className="muted">Loading…</p>}
        {state.kind === 'not_configured' && (
          <p className="notice">
            Google sign-in isn't set up yet. Add <code>GOOGLE_CLIENT_ID</code> to{' '}
            <code>server/.env</code> and restart the server.
          </p>
        )}
        {state.kind === 'error' && <p className="notice error">{state.message}</p>}
        {refused && <p className="notice error">{refused}</p>}
      </div>
    </main>
  );
}
