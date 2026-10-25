/**
 * Where the site dashboard is: closed, or open on a page (and maybe one item on it), mirrored in
 * the address as /site/<page>[/<item>]. Back to writing returns to the address the editor had.
 * adr: adr/site-dashboard.md
 */
import { useSyncExternalStore } from 'react';

export const PAGES = ['home', 'posts', 'subscribers', 'stats', 'comments', 'surveys', 'growth', 'money', 'settings', 'publish'] as const;
export type SitePage = (typeof PAGES)[number];

export interface SiteNav { open: boolean; page: SitePage; item: string | null }

let state: SiteNav = { open: false, page: 'home', item: null };
let returnTo = '/';
const listeners = new Set<() => void>();

function set(next: SiteNav): void {
  state = next;
  listeners.forEach((fn) => fn());
}

export function useNav(): SiteNav {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
}

export function navState(): SiteNav {
  return state;
}

function parse(path: string): { page: SitePage; item: string | null } | null {
  const m = path.match(/^\/site(?:\/([a-z]+))?(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  const page = (PAGES as readonly string[]).includes(m[1] || 'home') ? (m[1] || 'home') as SitePage : 'home';
  return { page, item: m[2] ? decodeURIComponent(m[2]) : null };
}

function pathOf(page: SitePage, item: string | null): string {
  return `/site/${page}${item ? `/${encodeURIComponent(item)}` : ''}`;
}

/** Open the dashboard on a page, or move to another page while it is open. */
export function go(page: SitePage, item: string | null = null): void {
  if (!state.open) returnTo = location.pathname + location.search + location.hash;
  const path = pathOf(page, item);
  if (location.pathname !== path) history.pushState({ owSite: true }, '', path);
  set({ open: true, page, item });
}

/** Back to writing: the dashboard closes and the address is the editor's again. */
export function close(): void {
  if (!state.open) return;
  history.pushState(null, '', returnTo.startsWith('/site') ? '/' : returnTo);
  set({ ...state, open: false });
}

/**
 * The app writes its document's address (/d/...) with replaceState when the first document
 * arrives. If the dashboard is open by then (a reload on /site/...), that address becomes Back to
 * writing's target and the dashboard's own address is put back.
 */
export function reclaimAddress(): void {
  if (!state.open || location.pathname.startsWith('/site')) return;
  returnTo = location.pathname + location.search + location.hash;
  history.replaceState({ owSite: true }, '', pathOf(state.page, state.item));
}

/** Follow the address: on load (a reload on /site/...) and on the browser's Back and Forward. */
export function startNav(): () => void {
  const follow = () => {
    const at = parse(location.pathname);
    if (at) {
      if (!state.open) returnTo = '/';
      set({ open: true, ...at });
    } else if (state.open) {
      returnTo = location.pathname + location.search + location.hash;
      set({ ...state, open: false });
    }
  };
  // The page may have loaded at /site/... and had its address replaced by the app before this
  // module ran (client modules load after the first document can arrive): open from the address
  // the page was loaded at, and put it back.
  const loadedAt = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.name;
  const first = !parse(location.pathname) && loadedAt ? parse(new URL(loadedAt).pathname) : null;
  const appAddress = location.pathname + location.search + location.hash;
  if (first) history.replaceState({ owSite: true }, '', pathOf(first.page, first.item));
  follow();
  if (first) returnTo = appAddress;
  window.addEventListener('popstate', follow);
  return () => window.removeEventListener('popstate', follow);
}
