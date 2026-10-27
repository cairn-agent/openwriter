/**
 * The browser's part of automatic sync. The server commits every save and
 * sends it to GitHub after the writer pauses; the browser asks for GitHub's
 * changes when the app opens, when the window gets focus, as a document opens
 * (without holding it up), and every minute while it is visible. It sends what is left when the
 * page closes. All of it lives in the open page, so a server with no browser
 * connected runs nothing and can sleep. adr: adr/two-way-sync.md
 */
import { useCallback, useEffect, useRef } from 'react';
import type { SyncStatus } from '../ws/client';

const PULL_EVERY_MS = 60000;
/** A pull the server put off because the writer is typing is asked again after this. */
const RETRY_DEFERRED_MS = 4000;
export function useAutoSync(configured: boolean, onStatus: (status: SyncStatus) => void): { pullOnOpen: () => void } {
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const pull = useCallback(async (): Promise<void> => {
    // A pull already on its way brings the same changes; clicking through documents starts one, not one each.
    if (running.current) return;
    if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    running.current = true;
    try {
      const res = await fetch('/api/sync/pull', { method: 'POST' });
      const status: SyncStatus = await res.json();
      if (status.deferred) { retry.current = setTimeout(() => { void pull(); }, RETRY_DEFERRED_MS); return; }
      onStatusRef.current(status);
    } catch { /* the server is restarting; the next trigger tries again */ } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    void pull();
    const onFocus = () => { void pull(); };
    const onClose = () => { navigator.sendBeacon?.('/api/sync/push'); };
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, PULL_EVERY_MS);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onClose);
    return () => {
      clearInterval(timer);
      if (retry.current) clearTimeout(retry.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onClose);
    };
  }, [configured, pull]);

  // The document opens at once; if GitHub had a newer copy, the server reloads it in place.
  const pullOnOpen = useCallback(() => {
    if (configured) void pull();
  }, [configured, pull]);

  return { pullOnOpen };
}
