/**
 * The Versions tab's synced history: every saved version of the open document
 * from every device, as "<device> · <time>", each with Restore; and "Roll back
 * everything to…" a time, with a preview of what changes. A restore or a roll
 * back is a new change on top, so it can itself be undone. Shown only when
 * sync is set up. adr: adr/two-way-sync.md
 */
import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../utils/toast';
import { noticeTime } from './sync-notice-plugin';

interface DocVersion { sha: string; device: string; time: string }

const SHOWN = 20;

function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SyncHistory({ docId }: { docId: string | null }) {
  const [configured, setConfigured] = useState(false);
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [at, setAt] = useState(() => localInputValue(new Date(Date.now() - 60 * 60 * 1000)));
  const [preview, setPreview] = useState<string[] | null>(null);

  useEffect(() => {
    fetch('/api/sync/status').then((r) => r.json()).then((s) => setConfigured(s.state !== 'unconfigured')).catch(() => setConfigured(false));
  }, []);

  const load = useCallback(() => {
    if (!configured || !docId) { setVersions([]); return; }
    fetch(`/api/sync/history/${docId}`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((d) => setVersions(Array.isArray(d.versions) ? d.versions : []))
      .catch(() => setVersions([]));
  }, [configured, docId]);
  useEffect(() => { load(); }, [load]);

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json().catch(() => ({}));
  };

  const restore = async (v: DocVersion) => {
    if (busy || !docId) return;
    setBusy(true);
    const res = await post('/api/sync/history/restore', { docId, sha: v.sha });
    setBusy(false);
    if (res.ok) { showToast(`Restored the version from ${v.device}, ${noticeTime(v.time)}`); load(); }
    else showToast(res.error || 'Could not restore', 'error');
  };

  const when = () => new Date(at).toISOString();

  const previewRollback = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sync/rollback?at=${encodeURIComponent(when())}`).then((r) => r.json());
      if (res.ok) setPreview(res.documents || []);
      else showToast(res.error || 'Could not look back that far', 'error');
    } catch { showToast('Could not look back that far', 'error'); }
    setBusy(false);
  };

  const rollBack = async () => {
    setBusy(true);
    const res = await post('/api/sync/rollback', { at: when() });
    setBusy(false);
    if (!res.ok) { showToast(res.error || 'Could not roll back', 'error'); return; }
    showToast(`Rolled back ${res.documents?.length ?? 0} documents. You can roll back this too.`);
    setRollOpen(false);
    setPreview(null);
    load();
  };

  if (!configured) return null;

  return (
    <div className="sync-history">
      <div className="sync-history__head">On all your devices</div>
      {versions.length === 0 ? (
        <div className="versions-tab__empty">No synced versions of this document yet.</div>
      ) : (
        <>
          {(showAll ? versions : versions.slice(0, SHOWN)).map((v, i) => (
            <div key={v.sha} className="sync-history__row">
              <span>{v.device} · {noticeTime(v.time)}</span>
              {i === 0 ? <span className="sync-history__now">Current</span> : (
                <button className="commit-row__restore" disabled={busy} onClick={() => restore(v)}>Restore</button>
              )}
            </div>
          ))}
          {!showAll && versions.length > SHOWN && (
            <button className="sync-history__more" onClick={() => setShowAll(true)}>Show {versions.length - SHOWN} older</button>
          )}
        </>
      )}

      {!rollOpen ? (
        <button className="versions-tab__save-btn sync-history__rollback" onClick={() => setRollOpen(true)}>Roll back everything to…</button>
      ) : (
        <div className="sync-history__rollform">
          <label>
            Every document as it was at
            <input type="datetime-local" value={at} max={localInputValue(new Date())} onChange={(e) => { setAt(e.target.value); setPreview(null); }} />
          </label>
          {preview === null ? (
            <div>
              <button className="versions-tab__save-btn" disabled={busy || !at} onClick={previewRollback}>{busy ? 'Looking…' : 'See what changes'}</button>
              <button className="versions-tab__save-btn" disabled={busy} onClick={() => setRollOpen(false)}>Cancel</button>
            </div>
          ) : (
            <div>
              <div className="sync-history__count">
                {preview.length === 0 ? 'Nothing would change.' : preview.length === 1 ? '1 document will change:' : `${preview.length} documents will change:`}
              </div>
              {preview.length > 0 && <ul className="sync-history__list">{preview.slice(0, 12).map((t) => <li key={t}>{t}</li>)}{preview.length > 12 && <li>and {preview.length - 12} more</li>}</ul>}
              <button className="versions-tab__save-btn" disabled={busy || preview.length === 0} onClick={rollBack}>{busy ? 'Rolling back…' : 'Roll back'}</button>
              <button className="versions-tab__save-btn" disabled={busy} onClick={() => { setRollOpen(false); setPreview(null); }}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
