import { useEffect, useRef, useState } from 'react';
import type { OutlineSection } from './model';
import { outlineRequest, type LibraryFolder, type OutlineLibrary, type SourceDocument } from './useOutlineLibrary';

export interface PickedDocument { docId: string; title: string }
interface Props {
  chapter: string;
  sections: OutlineSection[];
  library: OutlineLibrary;
  excluded: Set<string>;
  initialSelection?: PickedDocument[];
  replace?: boolean;
  onAdd: (chapter: string, documents: PickedDocument[]) => boolean;
  onClose: () => void;
}

function descendants(folder: LibraryFolder): SourceDocument[] {
  return folder.ordered;
}

export default function DocumentPicker({ chapter, sections, library, excluded, initialSelection = [], replace, onAdd, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState(chapter);
  const [query, setQuery] = useState('');
  const [space, setSpace] = useState(() => library.tree.find(w => descendants(w).some(d => d.isActive))?.filename || library.tree[0]?.filename || 'unfiled');
  const [basket, setBasket] = useState<PickedDocument[]>(() => [...new Map(initialSelection.map(d => [d.docId, d])).values()]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; text: string; words: number } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const target = sections.find(s => s.key === destination);
  const linked = new Set(target?.references.map(r => r.docId) || []);
  // The existing API calls outline documents "manuscript"; compiled books are ordinary documents.
  const visibleSource = (d: SourceDocument) => !excluded.has(d.docId) && !library.briefIds.has(d.docId) && d.contentType !== 'manuscript';
  const eligible = (d: SourceDocument) => visibleSource(d) && !linked.has(d.docId);
  const selected = new Set(basket.map(d => d.docId));
  const chosenSpace = library.tree.find(w => w.filename === space);
  const searching = query.trim().length > 0;
  const matches = (d: SourceDocument) => d.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const previous = active?.closest('details')?.querySelector('summary') || active;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!previewId) return;
    let cancelled = false;
    setPreview(null); setPreviewError('');
    outlineRequest<{ title: string; text: string; words: number }>(`/api/book/source?docId=${encodeURIComponent(previewId)}`)
      .then(value => { if (!cancelled) setPreview(value); })
      .catch(e => { if (!cancelled) setPreviewError(e.message); });
    return () => { cancelled = true; };
  }, [previewId]);
  const toggle = (docs: SourceDocument[], checked: boolean) => {
    const available = docs.filter(eligible);
    const ids = new Set(available.map(d => d.docId));
    setBasket(current => checked
      ? replace ? available.slice(0, 1).map(d => ({ docId: d.docId, title: d.title }))
        : [...current, ...available.filter(d => !current.some(p => p.docId === d.docId)).map(d => ({ docId: d.docId, title: d.title }))]
      : current.filter(d => !ids.has(d.docId)));
  };
  const move = (index: number, direction: number) => setBasket(current => {
    const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next;
  });
  const elsewhere = (id: string) => sections.filter(s => s.key !== destination && s.references.some(r => r.docId === id)).map(s => s.title);
  const documentRow = (d: SourceDocument) => {
    const other = elsewhere(d.docId);
    return <div className="outline-choice" key={d.docId}>
      <label><input type="checkbox" checked={linked.has(d.docId) || selected.has(d.docId)} disabled={!eligible(d)} onChange={e => toggle([d], e.target.checked)} />
        <span>{d.title}<small>{library.contexts.get(d.docId)?.join(' · ') || 'Unfiled'} · {d.wordCount.toLocaleString()} words</small>
          {linked.has(d.docId) ? <small>Already in this chapter</small> : other.length > 0 && <small>Also in {other.join(', ')}</small>}</span>
      </label>
      <button type="button" className="outline-quiet" onClick={() => setPreviewId(d.docId)} aria-label={`Preview ${d.title}`}>Preview</button>
    </div>;
  };
  const folderRow = (folder: LibraryFolder, root = false): React.ReactNode => {
    const visible = [...new Map(descendants(folder)
      .filter(d => matches(d) && visibleSource(d))
      .map(d => [d.docId, d])).values()];
    const all = visible.filter(eligible);
    if (!visible.length) return null;
    const count = all.filter(d => selected.has(d.docId)).length;
    const content = <>
      {!replace && <label className="outline-folder-check"><input type="checkbox" aria-label={`Select ${searching ? 'matching' : 'all'} documents in ${folder.title}`} checked={all.length > 0 && count === all.length} ref={el => { if (el) el.indeterminate = count > 0 && count < all.length; }} disabled={!all.length} onChange={e => toggle(all, e.target.checked)} /> {searching ? 'Select matches' : 'Select folder'} ({all.length})</label>}
      {searching ? visible.map(documentRow) : <>
        {folder.documents.filter(visibleSource).map(documentRow)}
        {folder.children.map(child => folderRow(child))}
      </>}
    </>;
    return root ? <div key={folder.key}>{content}</div> : <details className="outline-folder" key={folder.key}><summary>{folder.title}</summary>{content}</details>;
  };
  const invalid = basket.some(d => {
    const source = library.byId.get(d.docId);
    return !source || !eligible(source);
  });
  const noMatches = !chosenSpace || !descendants(chosenSpace).some(d => matches(d) && visibleSource(d));
  return <dialog ref={dialog} className="outline-dialog outline-picker" aria-labelledby="outline-picker-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="outline-dialog-head"><h2 id="outline-picker-title">{replace ? 'Replace document' : `Add documents${target ? ` to “${target.title}”` : ''}`}</h2><button type="button" onClick={onClose} aria-label="Close document picker">×</button></header>
    {!target && <p role="alert">This chapter was removed. Your selection is kept; choose a destination.</p>}
    {!replace && <label className="outline-field">Destination chapter<select value={destination} onChange={e => setDestination(e.target.value)}><option value="" disabled>Choose a chapter</option>{!target && <option value={destination} disabled>Removed chapter</option>}{sections.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label>}
    <p className="outline-muted">Choose source documents in reading order. Outlines, attached briefs and this book’s manuscripts are excluded. Changes awaiting review are not included when building.</p>
    <div className="outline-picker-grid"><div>
      <label className="outline-field">Workspace<select value={space} onChange={e => setSpace(e.target.value)}>{library.tree.map(w => <option value={w.filename} key={w.filename}>{w.title}</option>)}</select></label>
      <label className="outline-field">Search documents<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title" /></label>
      {library.error ? <p role="alert">{library.error} <button type="button" onClick={library.reload}>Retry</button></p> : !library.loaded ? <p role="status">Loading documents…</p> : noMatches ? <p role="status">{searching ? `No documents match “${query}”.` : 'No eligible documents in this workspace. Choose another workspace.'} {searching && <button type="button" onClick={() => setQuery('')}>Clear search</button>}</p> : chosenSpace && folderRow(chosenSpace, true)}
    </div><section aria-label="Selected documents"><h3>Added in this order · {basket.length}</h3>
      {!basket.length && <p className="outline-muted">Select documents to append to this chapter.</p>}
      <ol className="outline-basket">{basket.map((d, index) => <li key={d.docId}><div className="outline-grow">{d.title}{elsewhere(d.docId).length > 0 && <small>Includes the same source again</small>}{linked.has(d.docId) && <small>Already in the destination; remove from selection.</small>}{!library.byId.has(d.docId) && library.loaded && <small>Source unavailable; remove from selection.</small>}</div><div className="outline-actions"><button type="button" disabled={index === 0} aria-label={`Move ${d.title} earlier`} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === basket.length - 1} aria-label={`Move ${d.title} later`} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Remove ${d.title} from selection`} onClick={() => setBasket(current => current.filter(p => p.docId !== d.docId))}>×</button></div></li>)}</ol>
    </section></div>
    {previewId && <section className="outline-preview" aria-label="Source preview"><header><h3>{preview?.title || 'Source preview'}</h3><button type="button" onClick={() => setPreviewId(null)}>Close preview</button></header>{previewError ? <p role="alert">{previewError}</p> : preview ? <><p className="outline-muted">{preview.words.toLocaleString()} accepted words · Read only</p><div>{preview.text || 'This source has no accepted text yet.'}</div></> : <p role="status">Loading accepted text…</p>}</section>}
    <footer className="outline-dialog-footer"><button type="button" className="outline-primary" disabled={!target || !basket.length || invalid || !library.loaded} onClick={() => { if (onAdd(destination, basket)) onClose(); }}>{replace ? 'Replace document' : `Add ${basket.length} ${basket.length === 1 ? 'document' : 'documents'}`}</button><button type="button" onClick={onClose}>Cancel</button></footer>
  </dialog>;
}
