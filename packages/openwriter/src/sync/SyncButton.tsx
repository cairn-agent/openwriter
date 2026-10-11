/**
 * Sync button cluster — sync state pill + (optional) details chevron + pending
 * changes dropdown. Lives in the right-rail topbar (post-2026-05-23 refactor).
 * Was previously in the titlebar; moved to mirror the left sidebar's pattern
 * where chrome controls live in the panel's own topbar, not in the global
 * titlebar.
 *
 * adr: adr/right-rail.md
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '../ws/client';

interface PendingFile {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  file: string;
}

interface SyncButtonProps {
  syncStatus: SyncStatus;
  onSync: () => void;
}

const CloudIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudCheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 14l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 16v-5M9.5 13.5L12 11l2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudErrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 14l-4 4M10 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function SyncButton({ syncStatus, onSync }: SyncButtonProps) {
  const [showPending, setShowPending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const pendingRef = useRef<HTMLDivElement>(null);

  // Files that changed on both sides: the last sync kept ours and saved
  // GitHub's version next to it. adr: adr/two-way-sync.md
  const conflicts = syncStatus.conflicts ?? [];
  const hasPending = syncStatus.state === 'pending' && !!syncStatus.pendingFiles;
  const hasDetails = hasPending || conflicts.length > 0;

  const togglePendingDetails = useCallback(() => {
    if (showPending) {
      setShowPending(false);
      return;
    }
    setShowPending(true);
    if (!hasPending) { setPendingFiles([]); return; }
    setLoadingPending(true);
    fetch('/api/sync/pending')
      .then(r => r.json())
      .then((files: PendingFile[]) => setPendingFiles(files))
      .catch(() => setPendingFiles([]))
      .finally(() => setLoadingPending(false));
  }, [showPending, hasPending]);

  // Close dropdown when there is nothing left to show (e.g. sync starts)
  useEffect(() => {
    if (!hasDetails || syncStatus.state === 'syncing') setShowPending(false);
  }, [hasDetails, syncStatus.state]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showPending) return;
    const handler = (e: MouseEvent) => {
      if (pendingRef.current && !pendingRef.current.contains(e.target as Node)) {
        setShowPending(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPending]);

  return (
    <div className="sync-btn-group" ref={pendingRef}>
      <button
        className={`titlebar-btn sync-btn-state sync-${syncStatus.state}`}
        onClick={onSync}
        disabled={syncStatus.state === 'syncing'}
        title={`Sync with GitHub: get changes from GitHub and send yours${syncStatus.lastSyncTime ? `\nLast synced: ${new Date(syncStatus.lastSyncTime).toLocaleString()}` : ''}`}
      >
        {syncStatus.state === 'unconfigured' && <><CloudIcon /> Sync</>}
        {syncStatus.state === 'synced' && <><CloudCheckIcon /> Synced</>}
        {syncStatus.state === 'pending' && <><CloudUpIcon /> Sync{syncStatus.pendingFiles ? ` (${syncStatus.pendingFiles})` : ''}</>}
        {syncStatus.state === 'syncing' && <><div className="sync-btn-spinner" /> Syncing...</>}
        {syncStatus.state === 'error' && <><CloudErrorIcon /> Retry</>}
      </button>
      {hasDetails && (
        <button
          className="sync-details-btn"
          onClick={togglePendingDetails}
          title={conflicts.length ? 'Some files changed in both places' : 'View changes not yet synced'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d={showPending ? 'M3 7.5L6 4.5L9 7.5' : 'M3 4.5L6 7.5L9 4.5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {showPending && (
        <div className="sync-pending-dropdown">
          {conflicts.length > 0 && (
            <>
              <div className="sync-pending-header">Changed in both places</div>
              <div className="sync-pending-loading">
                Your version was kept. GitHub's version was saved next to it:
              </div>
              <div className="sync-pending-list">
                {conflicts.map((f) => (
                  <div key={f} className="sync-pending-item sync-file-added">
                    <span className="sync-file-badge">!</span>
                    <span className="sync-file-name">{f}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {hasPending && <div className="sync-pending-header">Changes not yet synced</div>}
          {!hasPending ? null : loadingPending ? (
            <div className="sync-pending-loading">Loading...</div>
          ) : pendingFiles.length === 0 ? (
            <div className="sync-pending-loading">No changes</div>
          ) : (
            <div className="sync-pending-list">
              {pendingFiles.map((f, i) => (
                <div key={i} className={`sync-pending-item sync-file-${f.status}`}>
                  <span className="sync-file-badge">{f.status[0].toUpperCase()}</span>
                  <span className="sync-file-name">{f.file}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
