import { useEffect, useState } from 'react';
import type { JobStatus } from './api';
import type { Verification } from './types';

/**
 * Pages live in the address's #part (#/jobs/job_…), so any page can be
 * bookmarked or sent to someone. The #part never reaches the server, so
 * it can't clash with the /admin API.
 */
export type Route =
  | { page: 'dashboard' }
  | { page: 'jobs'; status?: JobStatus; q?: string }
  | { page: 'job'; id: string }
  | { page: 'engineering' }
  | { page: 'settings' }
  | { page: 'catalog' }
  | { page: 'disputes' }
  | { page: 'customers'; q?: string }
  | { page: 'mechanics'; verification?: Verification }
  | { page: 'person'; id: string }
  | { page: 'finance' }
  | { page: 'audit' }
  | { page: 'staff' };

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [first, second] = path.split('/').map(decodeURIComponent);
  const params = new URLSearchParams(query);
  switch (first) {
    case 'jobs':
      return second
        ? { page: 'job', id: second }
        : {
            page: 'jobs',
            ...(params.get('status') && { status: params.get('status') as JobStatus }),
            ...(params.get('q') && { q: params.get('q')! }),
          };
    case 'people':
      return second ? { page: 'person', id: second } : { page: 'customers' };
    case 'customers':
      return { page: 'customers', ...(params.get('q') && { q: params.get('q')! }) };
    case 'mechanics':
      return {
        page: 'mechanics',
        ...(params.get('verification') && {
          verification: params.get('verification') as Verification,
        }),
      };
    case 'engineering':
    case 'settings':
    case 'catalog':
    case 'disputes':
    case 'finance':
    case 'audit':
    case 'staff':
      return { page: first };
    default:
      return { page: 'dashboard' };
  }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'job':
      return `#/jobs/${encodeURIComponent(route.id)}`;
    case 'jobs': {
      const params = new URLSearchParams();
      if (route.status) {
        params.set('status', route.status);
      }
      if (route.q) {
        params.set('q', route.q);
      }
      const query = params.toString();
      return `#/jobs${query ? `?${query}` : ''}`;
    }
    case 'person':
      return `#/people/${encodeURIComponent(route.id)}`;
    case 'customers':
      return route.q ? `#/customers?q=${encodeURIComponent(route.q)}` : '#/customers';
    case 'mechanics':
      return route.verification ? `#/mechanics?verification=${route.verification}` : '#/mechanics';
    case 'dashboard':
      return '#/';
    default:
      return `#/${route.page}`;
  }
}

/** Replaces the current address without adding a Back step (for filters). */
export const replaceRoute = (route: Route) =>
  window.history.replaceState(null, '', href(route));

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
