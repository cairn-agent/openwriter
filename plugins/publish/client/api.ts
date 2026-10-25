/**
 * The site dashboard's data: every read and every action is one of the publish plugin's tools
 * (the same ones the chat agent uses), run through /api/mcp-call with the chosen site.
 * adr: adr/site-dashboard.md
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { callTool } from './bridge';

/**
 * The site the dashboard acts on: a site's id from list_my_sites, or null for the profile's own.
 * Remembered in this browser for each OpenWriter profile: list_my_sites lists every site of the
 * account, so a choice made under one profile must never carry over to another (switching from a
 * test profile to the real one would otherwise act on the wrong site).
 */
const KEY_STORE = 'ows-site-by-profile';
let profile: string | null = null;
let siteKey: string | null = null;
const listeners = new Set<() => void>();

function stored(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY_STORE) || '{}') || {}; } catch { return {}; }
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function setSiteKey(key: string | null): void {
  if (key === siteKey) return;
  siteKey = key;
  if (profile) {
    const all = stored();
    if (key) all[profile] = key; else delete all[profile];
    try { localStorage.setItem(KEY_STORE, JSON.stringify(all)); } catch { /* private window */ }
  }
  notify();
}

/** Take the active profile's remembered site; run before the dashboard loads its site. */
export async function followProfile(): Promise<void> {
  let active: string | null = null;
  try {
    const res = await fetch('/api/profiles');
    if (res.ok) active = (await res.json())?.active ?? null;
  } catch { /* keep what we have */ }
  if (!active || active === profile) return;
  profile = active;
  const next = stored()[active] ?? null;
  if (next !== siteKey) { siteKey = next; notify(); }
}

/** A site address as it is typed: lower case, spaces become hyphens, nothing else but a-z, 0-9 and -. */
export function slugInput(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function useSiteKey(): string | null {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => siteKey);
}

/** Run a tool on the chosen site. Errors throw with the tool's own sentence. */
export function run<T = any>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  return callTool<T>(tool, siteKey ? { site: siteKey, ...args } : args);
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Read a tool's result for a page; it reloads when the site or the args change. */
export function useTool<T = any>(tool: string, args: Record<string, unknown> = {}): Loaded<T> {
  const key = useSiteKey();
  const argKey = JSON.stringify(args);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    run<T>(tool, JSON.parse(argKey))
      .then((data) => { if (live) setState({ data, error: null, loading: false }); })
      .catch((err: any) => { if (live) setState({ data: null, error: err?.message || 'That did not load.', loading: false }); });
    return () => { live = false; };
  }, [tool, argKey, key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// ---- formatting ----

export function money(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents === null || cents === undefined) return '-';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${(currency || '').toUpperCase()}`;
  }
}

export function count(n: number | null | undefined, one: string, many = `${one}s`): string {
  const v = n ?? 0;
  return `${v.toLocaleString()} ${v === 1 ? one : many}`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function percent(part: number, whole: number): string {
  if (!whole) return '-';
  return `${Math.round((part / whole) * 100)}%`;
}

export function host(address: string | null | undefined): string {
  return (address || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}
