import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { outlineRequest } from './useOutlineLibrary';

interface BuildPreview {
  revision: string;
  title: string;
  chapters: { title: string; words: number; documents: number }[];
  totalWords: number;
  documents: number;
  emptyChapters: string[];
  warnings: string[];
  pendingChanges: number;
  sources: { docId: string; title: string; filename: string; words: number; pendingChanges: number; missing?: boolean }[];
}
interface Props {
  editor: Editor;
  docId: string;
  another: boolean;
  beforeBuild: () => Promise<void>;
  onReview: () => void;
  onBuilt: (filename: string) => void;
  onClose: () => void;
}

// Saving may assign canonical block IDs without changing the reviewed writing.
// Keep content, order, links and pending fields; ignore only IDs and empty attributes.
function outlineContentKey(editor: Editor): string {
  const normalize = (value: unknown, inAttrs = false): unknown => {
    if (Array.isArray(value)) return value.filter(item => item != null).map(item => normalize(item));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort()
      .filter(key => record[key] != null && !(inAttrs && key === 'id'))
      .map(key => [key, normalize(record[key], key === 'attrs')]));
  };
  return JSON.stringify(normalize(editor.getJSON()));
}

export default function BuildOutlineDialog({ editor, docId, another, beforeBuild, onReview, onBuilt, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const reviewedKey = useRef(outlineContentKey(editor));
  const [preview, setPreview] = useState<BuildPreview | null>(null);
  const [busy, setBusy] = useState<'checking' | 'building' | null>('checking');
  const [error, setError] = useState('');
  const [emptyAllowed, setEmptyAllowed] = useState(false);
  const [acceptedAllowed, setAcceptedAllowed] = useState(false);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const changed = () => { if (outlineContentKey(editor) !== reviewedKey.current) setChanged(true); };
    editor.on('transaction', changed);
    return () => { alive.current = false; editor.off('transaction', changed); if (previous?.isConnected) previous.focus(); };
  }, [editor]);
  const check = async () => {
    setBusy('checking'); setError(''); setPreview(null); setEmptyAllowed(false); setAcceptedAllowed(false);
    const snapshot = outlineContentKey(editor);
    try {
      await beforeBuild();
      if (!alive.current) return;
      if (outlineContentKey(editor) !== snapshot) throw new Error('The outline changed while saving. Review the latest outline, then check again.');
      const data = await outlineRequest<BuildPreview>(`/api/book/outline?docId=${encodeURIComponent(docId)}`);
      if (!alive.current) return;
      if (outlineContentKey(editor) !== snapshot) throw new Error('The outline changed while checking. Check again to review the latest order.');
      reviewedKey.current = snapshot; setChanged(false); setPreview(data);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not check this outline.'); }
    finally { if (alive.current) setBusy(null); }
  };
  useEffect(() => { void check(); }, [docId]);
  const build = async () => {
    if (!preview) return;
    setBusy('building'); setError('');
    try {
      await beforeBuild();
      if (!alive.current) return;
      if (outlineContentKey(editor) !== reviewedKey.current) throw new Error('The outline changed. Check again before building.');
      const latest = await outlineRequest<BuildPreview>(`/api/book/outline?docId=${encodeURIComponent(docId)}`);
      if (!alive.current) return;
      if (outlineContentKey(editor) !== reviewedKey.current || JSON.stringify(latest) !== JSON.stringify(preview)) {
        setChanged(true); throw new Error('The outline or its sources changed. Check again to review the current build.');
      }
      const made = await outlineRequest<{ filename: string }>('/api/book/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, confirm: another, revision: preview.revision }) });
      if (!alive.current) return;
      if (outlineContentKey(editor) !== reviewedKey.current) {
        setError('The manuscript was created from the reviewed text. The outline changed during the build; later edits are not included.');
        setCreated(made.filename);
      } else onBuilt(made.filename);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not build this manuscript.'); }
    finally { if (alive.current) setBusy(null); }
  };
  const [created, setCreated] = useState<string | null>(null);
  const missing = preview?.sources.filter(s => s.missing) || [];
  const blocked = !preview || !!busy || changed || missing.length > 0 || (!emptyAllowed && preview.emptyChapters.length > 0) || (!acceptedAllowed && preview.pendingChanges > 0);
  return <dialog ref={dialog} className="outline-dialog" aria-labelledby="outline-build-title" onCancel={e => { e.preventDefault(); if (busy !== 'building') onClose(); }}>
    <header className="outline-dialog-head"><h2 id="outline-build-title">{another ? 'Build another manuscript?' : 'Review manuscript'}</h2><button type="button" aria-label="Close build review" disabled={busy === 'building'} onClick={onClose}>×</button></header>
    <p>Creates a separate manuscript from the accepted text. Later outline or source edits will not change it.</p>
    {another && <p className="outline-note">Your existing manuscript stays as it is. This creates another copy.</p>}
    {busy === 'checking' && <p role="status">Saving the outline and checking its sources…</p>}
    {error && <p role="alert" className="outline-error">{error}</p>}
    {changed && !created && <p role="status">The outline has changed since this review. Check again before building.</p>}
    {preview && <><p>{preview.chapters.length} {preview.chapters.length === 1 ? 'chapter' : 'chapters'} · {preview.documents} document occurrences · {preview.totalWords.toLocaleString()} accepted words</p>
      <ol className="outline-build-list">{preview.chapters.map((c, i) => <li key={i}><span>{c.title || 'Untitled chapter'}</span><small>{c.documents} {c.documents === 1 ? 'document' : 'documents'} · {c.words.toLocaleString()} words</small></li>)}</ol>
      {missing.length > 0 && <div role="alert"><h3>Missing sources</h3><p>Close this review to replace or remove these links from the outline.</p><ul>{missing.map((s, i) => <li key={`${s.docId}-${i}`}>{s.title || s.docId}</li>)}</ul></div>}
      {preview.warnings.length > 0 && <ul className="outline-muted">{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      {preview.emptyChapters.length > 0 && <><p>Empty chapters: {preview.emptyChapters.join(', ')}.</p><label className="outline-check"><input type="checkbox" checked={emptyAllowed} onChange={e => setEmptyAllowed(e.target.checked)} />Build with empty chapters</label></>}
      {preview.pendingChanges > 0 && <div className="outline-note"><p>{preview.pendingChanges} changes awaiting review are excluded.</p><button type="button" disabled={busy === 'building'} onClick={() => { onClose(); onReview(); }}>Review changes</button><label className="outline-check"><input type="checkbox" checked={acceptedAllowed} onChange={e => setAcceptedAllowed(e.target.checked)} />Build accepted text only</label></div>}
    </>}
    <footer className="outline-dialog-footer">{created ? <button type="button" className="outline-primary" onClick={() => onBuilt(created)}>Open created manuscript</button> : <button type="button" className="outline-primary" disabled={blocked} onClick={() => void build()}>{busy === 'building' ? 'Building manuscript…' : another ? 'Build another manuscript' : 'Build manuscript'}</button>}{!created && <button type="button" disabled={!!busy} onClick={() => void check()}>Check again</button>}<button type="button" disabled={busy === 'building'} onClick={onClose}>Cancel</button></footer>
  </dialog>;
}
