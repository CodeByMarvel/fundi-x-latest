import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, SIGNED_OUT_EVENT, type Me, type Permission } from './api';
import { AuditLog } from './pages/AuditLog';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';

type Page = 'overview' | 'settings' | 'audit';

/** Pages, and the permission each needs. Hidden from anyone without it. */
const PAGES: { id: Page; label: string; needs?: Permission }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings', needs: 'settings.edit' },
  { id: 'audit', label: 'Audit log', needs: 'logs.view' },
];

export function App() {
  // undefined: still checking for a session; null: signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [page, setPage] = useState<Page>('overview');
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>('/me').then(setMe, err => {
      if (err instanceof ApiError && err.status !== 401 && err.status !== 403) {
        setStartupError(err.message);
      }
      setMe(null);
    });
    const signedOut = () => setMe(null);
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  // Stable between renders, so pages that load data on it don't reload.
  const can = useCallback(
    (p?: Permission) => !p || !!me?.permissions.includes(p),
    [me],
  );

  const onSignedIn = useCallback((who: Me) => {
    setStartupError(null);
    setPage('overview');
    setMe(who);
  }, []);

  async function signOut() {
    await api('/auth/sign-out', 'POST').catch(() => {});
    setMe(null);
  }

  if (me === undefined) {
    return <p className="muted center">Loading…</p>;
  }
  if (me === null) {
    return (
      <>
        {startupError && <p className="notice error banner">{startupError}</p>}
        <SignIn onSignedIn={onSignedIn} />
      </>
    );
  }

  const visible = PAGES.filter(p => can(p.needs));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icon-192.png" alt="" />
          <span>Fundi-X Admin</span>
        </div>
        <nav>
          {visible.map(p => (
            <button
              key={p.id}
              className={p.id === page ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="who">
          <span className="who-email">{me.email}</span>
          <span className="muted small">{me.role}</span>
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {page === 'overview' && <Overview can={can} go={setPage} />}
        {page === 'settings' && can('settings.edit') && <Settings />}
        {page === 'audit' && can('logs.view') && <AuditLog />}
      </main>
    </div>
  );
}
