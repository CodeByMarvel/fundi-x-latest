import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Me } from '../api';
import { loadGoogle } from '../google';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; google: boolean; dev: boolean }
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
        const config = await api<{
          googleClientId: string | null;
          devSignIn: boolean;
        }>('/config');
        const { googleClientId } = config;
        if (!googleClientId) {
          setState({ kind: 'ready', google: false, dev: config.devSignIn });
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
        setState({ kind: 'ready', google: true, dev: config.devSignIn });
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

  async function devSignIn() {
    setRefused(null);
    try {
      onSignedIn(await api<Me>('/auth/dev', 'POST'));
    } catch (err) {
      const fromServer = err instanceof ApiError && err.code !== 'unreachable';
      setRefused(fromServer ? err.message : explain(err));
    }
  }

  const ready = state.kind === 'ready' ? state : null;

  return (
    <main className="signin">
      <div className="signin-card">
        <img src="/icon-192.png" alt="" className="signin-logo" />
        <h1>Fundi-X Admin</h1>
        <p className="muted">
          Staff only.{ready?.google && ' Sign in with your Google account.'}
        </p>

        <div ref={button} className="google-button" hidden={!ready?.google} />
        {state.kind === 'loading' && <p className="muted">Loading…</p>}
        {ready?.dev && (
          <div className="dev-signin">
            <button className="primary wide" onClick={devSignIn}>
              Sign in as owner (development)
            </button>
            <p className="muted small">
              Works only on this computer, and never on the live server.
            </p>
          </div>
        )}
        {ready && !ready.google && !ready.dev && (
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
