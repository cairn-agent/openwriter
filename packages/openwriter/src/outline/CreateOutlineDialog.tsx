import { useEffect, useRef, useState } from 'react';
import type { DocumentInfo, WorkspaceWithData } from '../sidebar/sidebar-types';
import { checkedFetch, jsonRequest } from '../utils/request';
import './OutlineView.css';

/** Background creation allows the selection basket to be staged before navigation.
 * adr: adr/outline-editor.md */
export default function CreateOutlineDialog({ items, workspaces, onClose, onCreated }: {
  items: DocumentInfo[]; workspaces: WorkspaceWithData[]; onClose: () => void;
  onCreated: (filename: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const create = async () => {
    if (busy || !title.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await (await checkedFetch('/api/book/outline', jsonRequest('POST', { title: title.trim(), ...(workspace ? { workspaceFile: workspace } : {}) }))).json();
      sessionStorage.setItem(`ow-outline-selection:${result.docId}`, JSON.stringify(items.map(d => ({ docId: d.docId, title: d.title }))));
      onCreated(result.filename);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the outline.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="outline-create-dialog" aria-labelledby="outline-create-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); void create(); }}>
      <h2 id="outline-create-title">Create book outline from selection</h2>
      <label>Book title<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required disabled={busy} /></label>
      <label>Workspace<select value={workspace} onChange={e => setWorkspace(e.target.value)} disabled={busy}>
        <option value="">Unfiled documents</option>{workspaces.map(w => <option value={w.filename} key={w.filename}>{w.title}</option>)}
      </select></label>
      <p>{items.length} selected documents, in this order:</p>
      <ol>{items.map(d => <li key={d.docId}>{d.title}</li>)}</ol>
      <p>Name your first chapter next, then add these documents to it. Your originals stay unchanged.</p>
      {error && <p role="alert">{error}</p>}
      <div className="outline-create-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating outline…' : 'Create outline'}</button></div>
    </form>
  </dialog>;
}
