import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, SIGNED_OUT_EVENT, type Me, type Permission } from './api';
import { AuditLog } from './pages/AuditLog';
import { Catalog } from './pages/Catalog';
import { Customers } from './pages/Customers';
import { Disputes } from './pages/Disputes';
import { Finance } from './pages/Finance';
import { Mechanics } from './pages/Mechanics';
import { Person } from './pages/Person';
import { Dashboard } from './pages/Dashboard';
import { Engineering } from './pages/Engineering';
import { JobDetail } from './pages/JobDetail';
import { Jobs } from './pages/Jobs';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { href, useRoute, type Route } from './route';

type NavItem = { route: Route; label: string; needs?: Permission };

/**
 * The portal's sections (docs/admin-portal.md §3). Only built sections are
 * listed, and each item only for people allowed to open it.
 */
const SECTIONS: { title?: string; items: NavItem[] }[] = [
  { items: [{ route: { page: 'dashboard' }, label: 'Dashboard' }] },
  {
    title: 'Operations',
    items: [
      { route: { page: 'jobs' }, label: 'Jobs', needs: 'jobs.view' },
      { route: { page: 'mechanics' }, label: 'Mechanics', needs: 'users.view' },
    ],
  },
  {
    title: 'Customer care',
    items: [
      { route: { page: 'disputes' }, label: 'Disputes', needs: 'jobs.view' },
      { route: { page: 'customers' }, label: 'Customers', needs: 'users.view' },
    ],
  },
  {
    title: 'Finance',
    items: [{ route: { page: 'finance' }, label: 'Money', needs: 'money.view' }],
  },
  {
    title: 'Engineering',
    items: [{ route: { page: 'engineering' }, label: 'System health', needs: 'logs.view' }],
  },
  {
    title: 'Configuration',
    items: [
      { route: { page: 'catalog' }, label: 'Catalog', needs: 'catalog.edit' },
      { route: { page: 'settings' }, label: 'Settings', needs: 'settings.edit' },
    ],
  },
  {
    title: 'Security',
    items: [{ route: { page: 'audit' }, label: 'Audit log', needs: 'logs.view' }],
  },
];

/** Job detail belongs to Jobs in the menu; a person to Customers. */
const sectionOf = (route: Route) =>
  route.page === 'job' ? 'jobs' : route.page === 'person' ? 'customers' : route.page;

export function App() {
  // undefined: still checking for a session; null: signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [startupError, setStartupError] = useState<string | null>(null);
  const route = useRoute();

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

  const current = sectionOf(route);

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={href({ page: 'dashboard' })}>
          <img src="/icon-192.png" alt="" />
          <span>Fundi-X Admin</span>
        </a>
        <nav>
          {SECTIONS.map(section => {
            const items = section.items.filter(i => can(i.needs));
            if (!items.length) {
              return null;
            }
            return (
              <div key={section.title ?? 'top'} className="nav-group">
                {section.title && <span className="nav-title">{section.title}</span>}
                {items.map(i => (
                  <a
                    key={i.label}
                    href={href(i.route)}
                    className={i.route.page === current ? 'nav-item active' : 'nav-item'}
                  >
                    {i.label}
                  </a>
                ))}
              </div>
            );
          })}
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
        <Page route={route} can={can} />
      </main>
    </div>
  );
}

function Page({ route, can }: { route: Route; can: (p?: Permission) => boolean }) {
  switch (route.page) {
    case 'jobs':
      return can('jobs.view') ? <Jobs key={href(route)} route={route} /> : <NotAllowed />;
    case 'job':
      return can('jobs.view') ? <JobDetail key={route.id} id={route.id} can={can} /> : <NotAllowed />;
    case 'engineering':
      return can('logs.view') ? <Engineering can={can} /> : <NotAllowed />;
    case 'settings':
      return can('settings.edit') ? <Settings /> : <NotAllowed />;
    case 'catalog':
      return can('catalog.edit') ? <Catalog /> : <NotAllowed />;
    case 'disputes':
      return can('jobs.view') ? <Disputes /> : <NotAllowed />;
    case 'customers':
      return can('users.view') ? <Customers key={href(route)} route={route} /> : <NotAllowed />;
    case 'mechanics':
      return can('users.view') ? <Mechanics key={href(route)} route={route} /> : <NotAllowed />;
    case 'person':
      return can('users.view') ? <Person key={route.id} id={route.id} can={can} /> : <NotAllowed />;
    case 'finance':
      return can('money.view') ? <Finance /> : <NotAllowed />;
    case 'audit':
      return can('logs.view') ? <AuditLog /> : <NotAllowed />;
    default:
      return <Dashboard can={can} />;
  }
}

function NotAllowed() {
  return <p className="notice">Your role doesn't include this page.</p>;
}
