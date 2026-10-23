/**
 * The open document was deleted on another device, so it closed here:
 * "“Essay” was deleted on Maya's laptop · Undo". Undo brings it back on every
 * device and opens it. adr: adr/two-way-sync.md
 */
import type { SyncNotice } from '../ws/client';
import { showToast } from '../utils/toast';
import './SyncNotices.css';

interface DeletedNoticeProps {
  notices: SyncNotice[] | undefined;
  onOpen: (filename: string) => void;
}

export default function DeletedNotice({ notices, onOpen }: DeletedNoticeProps) {
  const deleted = (notices || []).filter((n) => n.kind === 'deleted');
  if (deleted.length === 0) return null;
  const post = (id: string, action: 'undo' | 'dismiss') =>
    fetch(`/api/sync/notices/${id}/${action}`, { method: 'POST' }).then((r) => r.json()).catch(() => ({}));
  return (
    <div className="sync-deleted-notices">
      {deleted.map((n) => (
        <div key={n.id} className="sync-deleted-notice">
          <span>&ldquo;{n.title || n.file.replace(/\.md$/, '')}&rdquo; was deleted on {n.device}</span>
          <span> · </span>
          <button onClick={async () => {
            const res = await post(n.id, 'undo');
            if (res.ok && res.filename) onOpen(res.filename);
            else showToast(res.error || 'Could not bring it back', 'error');
          }}>Undo</button>
          <button className="sync-deleted-close" title="Close" onClick={() => { void post(n.id, 'dismiss'); }}>&times;</button>
        </div>
      ))}
    </div>
  );
}
