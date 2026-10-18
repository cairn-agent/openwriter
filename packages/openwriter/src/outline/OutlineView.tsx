import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { readOutline, outlineTransaction, type OutlineReference, type OutlineSection } from './model';
import { showToast } from '../utils/toast';
import { useBookStatus } from '../hooks/useBookStatus';
import { derivePendingState } from '../hooks/usePendingState';
import { useOutlineLibrary } from './useOutlineLibrary';
import DocumentPicker, { type PickedDocument } from './DocumentPicker';
import BuildOutlineDialog from './BuildOutlineDialog';
import './OutlineView.css';

interface Props {
  editor: Editor | null;
  docId: string;
  filename: string;
  title: string;
  connected: boolean;
  onOpenSource: (filename: string) => void;
  onReview: () => void;
  beforeBuild: () => Promise<void>;
}
type Action = Parameters<typeof outlineTransaction>[1];
type Form = { kind: 'add' | 'rename'; key?: string; title: string } | { kind: 'remove'; key: string; title: string };
type Drag = { kind: 'chapter' | 'reference'; key: string };

const Chevron = ({ open }: { open: boolean }) => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
  style={{ transform: open ? undefined : 'rotate(-90deg)' }}><path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>;

function OutlineDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const previous = active?.closest('details')?.querySelector('summary') || active;
    ref.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="outline-dialog outline-dialog-small" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}><h2>{title}</h2>{children}</dialog>;
}

export default function OutlineView({ editor, docId, filename, title, connected, onOpenSource, onReview, beforeBuild }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Form | null>(null);
  const [picker, setPicker] = useState<{ chapter: string; replace?: string; initial?: PickedDocument[] } | null>(null);
  const [building, setBuilding] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [initialBasket, setInitialBasket] = useState<PickedDocument[]>([]);
  const basketReadFor = useRef<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const library = useOutlineLibrary();
  const [book] = useBookStatus(docId);
  const sections = useMemo(() => editor ? readOutline(editor.state.doc) : [], [editor, version]);
  const chapters = sections.filter(s => s.key !== 'intro');
  const manuscript = book?.manuscripts?.[0];
  const excluded = new Set([docId, ...(book?.manuscripts?.map(m => m.docId) || [])]);
  const pendingCount = useMemo(() => editor ? derivePendingState(editor).length : 0, [editor, version]);
  const focus = (key: string) => requestAnimationFrame(() => {
    (root.current?.querySelector<HTMLElement>(`[data-outline-focus="${CSS.escape(key)}"]`) || root.current?.querySelector<HTMLElement>('[data-outline-focus="add"]'))?.focus();
  });
  useEffect(() => {
    if (!editor) return;
    const update = () => setVersion(n => n + 1);
    editor.on('transaction', update); update();
    return () => { editor.off('transaction', update); };
  }, [editor]);
  useEffect(() => {
    if (basketReadFor.current === docId) return;
    basketReadFor.current = docId;
    setCollapsed(new Set()); setForm(null); setPicker(null); setBuilding(false); setInitialBasket([]);
    try {
      const key = `ow-outline-selection:${docId}`;
      const saved = sessionStorage.getItem(key);
      if (saved) {
        sessionStorage.removeItem(key);
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const selection = parsed.filter(d => d && typeof d.docId === 'string' && typeof d.title === 'string');
          setInitialBasket(selection);
          if (selection.length) setForm({ kind: 'add', title: '' });
        }
      }
    } catch { /* A blocked session store does not prevent editing an outline. */ }
    return () => { if (hover.current) clearTimeout(hover.current); };
  }, [docId]);
  useEffect(() => {
    if (!editor || !connected || !book) return;
    const consume = () => {
      try {
        if (sessionStorage.getItem('ow-book-build-request') !== docId) return;
        sessionStorage.removeItem('ow-book-build-request');
        // The workspace pin enters the same save/preflight/review flow.
        if (!book.manuscripts?.length) {
          if (!readOutline(editor.state.doc).some(section => section.key !== 'intro')) {
            showToast('Add a chapter and choose its documents before building the manuscript.', 'info');
            root.current?.querySelector<HTMLElement>('[data-outline-focus="add"]')?.focus();
          } else setBuilding(true);
        }
        else onOpenSource(book.manuscripts[0].filename);
      } catch { /* The normal outline Build button remains available. */ }
    };
    consume(); window.addEventListener('ow-book-build-request', consume);
    return () => window.removeEventListener('ow-book-build-request', consume);
  }, [docId, editor, connected, book, onOpenSource]);
  const undo = () => {
    if (editor?.commands.undo()) { setAnnouncement('Outline edit undone.'); focus('add'); }
  };
  const change = (action: Action, message: string, focusKey?: string): boolean => {
    if (!editor || editor.isDestroyed) return false;
    try {
      editor.view.dispatch(outlineTransaction(editor.state, action));
      setAnnouncement(message);
      if (focusKey) focus(focusKey);
      showToast(message, 'info', 4500, { label: 'Undo', onClick: undo });
      return true;
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not change the outline.', 'error', 6500); return false; }
  };
  const openPicker = (chapter: string, replace?: string) => setPicker({ chapter, replace, initial: replace ? [] : initialBasket });
  const addPicked = (chapter: string, documents: PickedDocument[]) => {
    const previousKeys = new Set(readOutline(editor!.state.doc).flatMap(s => s.references.map(r => r.key)));
    const action: Action = picker?.replace ? { type: 'replaceReference', key: picker.replace, ...documents[0] } : { type: 'addDocuments', chapter, documents };
    if (!change(action, picker?.replace ? 'Source link replaced. Original documents kept.' : `${documents.length} document links added.`)) return false;
    setInitialBasket([]);
    const fresh = readOutline(editor!.state.doc).find(s => s.key === chapter);
    focus(picker?.replace || fresh?.references.find(r => !previousKeys.has(r.key))?.key || `pick-${chapter}`);
    return true;
  };
  const submitTitle = () => {
    if (!form || form.kind === 'remove' || !editor) return;
    const name = form.title.trim();
    if (!name) { showToast('Name this chapter.', 'error'); return; }
    const old = new Set(readOutline(editor.state.doc).map(s => s.key));
    if (!change(form.kind === 'add' ? { type: 'addChapter', title: name, after: form.key } : { type: 'renameChapter', key: form.key!, title: name }, form.kind === 'add' ? 'Chapter added.' : 'Chapter renamed.')) return;
    const newChapter = form.kind === 'add' ? readOutline(editor.state.doc).find(s => !old.has(s.key)) : null;
    setForm(null);
    if (newChapter) {
      setCollapsed(current => new Set([...current].filter(k => k !== newChapter.key)));
      if (initialBasket.length) setPicker({ chapter: newChapter.key, initial: initialBasket });
      else focus(`pick-${newChapter.key}`);
    } else focus(`chapter-${form.key}`);
  };
  const moveChapter = (section: OutlineSection, direction: number) => {
    const latest = readOutline(editor!.state.doc).filter(s => s.key !== 'intro');
    const index = latest.findIndex(s => s.key === section.key);
    const destination = direction < 0 ? latest[index - 1] : latest[index + 2];
    change({ type: 'moveChapter', key: section.key, before: destination?.key }, `Moved “${section.title}” to chapter ${index + direction + 1}.`, `chapter-${section.key}`);
  };
  const moveReference = (section: OutlineSection, reference: OutlineReference, direction: number) => {
    const latest = readOutline(editor!.state.doc).find(s => s.key === section.key);
    if (!latest) return;
    const index = latest.references.findIndex(r => r.key === reference.key);
    change({ type: 'moveReference', key: reference.key, chapter: section.key, before: latest.references[index + (direction < 0 ? -1 : 2)]?.key }, `Moved “${reference.label}” ${direction < 0 ? 'earlier' : 'later'}.`, reference.key);
  };
  const clearDrag = () => { drag.current = null; setDropTarget(''); if (hover.current) clearTimeout(hover.current); };
  const dragOver = (event: React.DragEvent, section: OutlineSection, reference?: OutlineReference) => {
    if (!drag.current || (drag.current.kind === 'chapter' && section.key === 'intro')) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    setDropTarget(reference?.key || section.key);
    if (collapsed.has(section.key) && !hover.current && drag.current.kind === 'reference') hover.current = setTimeout(() => { setCollapsed(current => new Set([...current].filter(k => k !== section.key))); hover.current = null; }, 700);
  };
  const drop = (event: React.DragEvent, section: OutlineSection, reference?: OutlineReference) => {
    event.preventDefault(); event.stopPropagation();
    const item = drag.current;
    if (item && item.key !== (reference?.key || section.key)) {
      if (item.kind === 'chapter' && section.key !== 'intro') change({ type: 'moveChapter', key: item.key, before: section.key }, 'Chapter order updated.', `chapter-${item.key}`);
      if (item.kind === 'reference') change({ type: 'moveReference', key: item.key, chapter: section.key, before: reference?.key }, `Document moved to “${section.title}”.`, item.key);
    }
    clearDrag();
  };
  const handle = (kind: Drag['kind'], key: string, label: string) => <button type="button" className="outline-quiet outline-grip" draggable aria-label={`Drag ${label}; move controls are in Actions`} onDragStart={event => { drag.current = { kind, key }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); }} onDragEnd={clearDrag}>⠿</button>;
  const menu = (label: string, children: ReactNode) => <details className="outline-menu"><summary aria-label={`Actions for ${label}`}>•••</summary><div className="outline-menu-body" onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.parentElement?.removeAttribute('open'); }}>{children}</div></details>;
  const referenceRow = (section: OutlineSection, reference: OutlineReference, index: number) => {
    const source = library.byId.get(reference.docId);
    const missing = library.loaded && !source;
    const name = source?.title || reference.label || reference.docId;
    return <div className={`outline-document${dropTarget === reference.key ? ' outline-drop' : ''}`} key={reference.key} onDragOver={event => dragOver(event, section, reference)} onDrop={event => drop(event, section, reference)}>
      {handle('reference', reference.key, name)}<div className="outline-grow"><button className="outline-source" type="button" data-outline-focus={reference.key} onClick={() => source ? onOpenSource(source.filename) : showToast('This source is unavailable. Replace or remove its link.', 'error')}>{name}</button><small>{missing ? 'Missing source — replace or remove this link' : library.contexts.get(reference.docId)?.join(' · ') || 'Unfiled'}{reference.pending && ' · Changes awaiting review'}</small>{source && reference.label && reference.label !== source.title && <small>Outline label: {reference.label}</small>}</div>
      {source && <span className="outline-word-count">{source.wordCount.toLocaleString()} words</span>}
      {menu(name, <><button type="button" disabled={!source} onClick={() => source && onOpenSource(source.filename)}>Open source</button><button type="button" disabled={index === 0} onClick={() => moveReference(section, reference, -1)}>↑ Move up</button><button type="button" disabled={index === section.references.length - 1} onClick={() => moveReference(section, reference, 1)}>↓ Move down</button><label>Move to chapter<select value="" onChange={event => { const destination = event.target.value; if (destination) change({ type: 'moveReference', key: reference.key, chapter: destination }, `Document moved to “${sections.find(s => s.key === destination)?.title}”.`, reference.key); }}><option value="">Choose chapter…</option>{sections.filter(s => s.key !== section.key).map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label>{missing && <button type="button" onClick={() => openPicker(section.key, reference.key)}>Replace document…</button>}<button type="button" className="outline-danger" onClick={() => change({ type: 'removeReference', key: reference.key }, `Removed “${name}” from the outline. Original document kept.`, section.references[index + 1]?.key || section.references[index - 1]?.key || `pick-${section.key}`)}>Remove from outline</button></>)}
    </div>;
  };
  return <div className="outline-view" ref={root} data-outline-document={filename} onKeyDown={event => { if (event.key === 'Escape') { root.current?.querySelectorAll<HTMLDetailsElement>('details.outline-menu[open]').forEach(el => { el.open = false; el.querySelector('summary')?.focus(); }); } }}>
    <header className="outline-heading"><div><h1>{title || 'Untitled outline'}</h1><p className="outline-muted">Book outline</p></div><div className="outline-actions">{manuscript ? <button type="button" className="outline-primary" onClick={() => onOpenSource(manuscript.filename)}>Open manuscript</button> : <button type="button" className="outline-primary" disabled={!editor || !connected || !chapters.length} onClick={() => setBuilding(true)}>Build manuscript</button>}</div></header>
    {manuscript && <div className="outline-note">Outline edits do not change the existing manuscript. <button type="button" className="outline-quiet" disabled={!connected} onClick={() => setBuilding(true)}>Build another manuscript…</button></div>}
    <div className="outline-toolbar"><span>{chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'} · {sections.reduce((n, s) => n + s.references.length, 0)} document links</span><div className="outline-actions">{pendingCount > 0 && <button type="button" onClick={onReview}>Review {pendingCount} changes</button>}<button type="button" disabled={!editor?.can().undo()} onClick={undo}>Undo</button><button type="button" data-outline-focus="add" disabled={!editor} onClick={() => setForm({ kind: 'add', title: '' })}>+ Add chapter</button></div></div>
    {!editor ? <p role="status">Loading outline…</p> : !chapters.length && <div className="outline-empty"><h2>Start with a chapter.</h2><p>Name your first chapter, then choose the documents that belong in it.</p>{initialBasket.length > 0 && <p>{initialBasket.length} selected documents will be ready in Add documents.</p>}</div>}
    {sections.map(section => {
      const index = chapters.findIndex(s => s.key === section.key);
      const words = section.references.reduce((n, r) => n + (library.byId.get(r.docId)?.wordCount || 0), 0);
      const allWordsKnown = library.loaded && section.references.every(r => library.byId.has(r.docId));
      const entries = [...section.references.map((reference, index) => ({ pos: reference.from, key: reference.key, content: referenceRow(section, reference, index) })), ...section.subheadings.map(heading => ({ pos: heading.pos, key: `heading-${heading.pos}`, content: <h3 className="outline-subheading" style={{ paddingInlineStart: `${Math.max(0, heading.level - section.level - 1) * 14}px` }}>{heading.title || 'Untitled section'}</h3> }))].sort((a, b) => a.pos - b.pos);
      return <section className={`outline-chapter${dropTarget === section.key ? ' outline-drop' : ''}`} key={section.key} aria-label={section.title} onDragOver={event => dragOver(event, section)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && hover.current) { clearTimeout(hover.current); hover.current = null; } }} onDrop={event => drop(event, section)}>
        <div className="outline-chapter-head">
          {section.key !== 'intro' && handle('chapter', section.key, section.title)}
          <button type="button" className="outline-quiet outline-collapse"
            aria-label={`${collapsed.has(section.key) ? 'Expand' : 'Collapse'} ${section.title}`}
            aria-expanded={!collapsed.has(section.key)} data-outline-focus={`chapter-${section.key}`}
            onClick={() => setCollapsed(current => {
              const next = new Set(current);
              if (next.has(section.key)) next.delete(section.key); else next.add(section.key);
              return next;
            })}><Chevron open={!collapsed.has(section.key)} /></button>
          <div className="outline-grow">
            <small>{section.key === 'intro' ? 'Opening material' : `Chapter ${index + 1}`} · {section.references.length} {section.references.length === 1 ? 'document' : 'documents'}{allWordsKnown && ` · ${words.toLocaleString()} words`}</small>
            <h2>{section.title || 'Untitled chapter'}</h2>
          </div>
          {section.key !== 'intro' && menu(section.title, <>
            <button type="button" onClick={() => setForm({ kind: 'rename', key: section.key, title: section.title })}>Rename chapter</button>
            <button type="button" disabled={index === 0} onClick={() => moveChapter(section, -1)}>↑ Move up</button>
            <button type="button" disabled={index === chapters.length - 1} onClick={() => moveChapter(section, 1)}>↓ Move down</button>
            <button type="button" onClick={() => setForm({ kind: 'add', key: section.key, title: '' })}>Add chapter after this</button>
            <button type="button" className="outline-danger" onClick={() => {
              if (section.references.length || section.hasOtherContent || section.subheadings.length) setForm({ kind: 'remove', key: section.key, title: section.title });
              else change({ type: 'removeChapter', key: section.key }, 'Empty chapter removed.', `chapter-${chapters[index + 1]?.key || chapters[index - 1]?.key}`);
            }}>Remove chapter…</button>
          </>)}
        </div>
        {!collapsed.has(section.key) && <div className="outline-chapter-body">{entries.map(entry => <div key={entry.key}>{entry.content}</div>)}{!section.references.length && <p className="outline-muted">No documents yet.</p>}{section.hasOtherContent && <p className="outline-content-note">This section also contains text or structure. <button type="button" className="outline-quiet" onClick={onReview}>View in Text</button></p>}{section.pending && <p className="outline-content-note">Some content awaits review. Review the affected changes before moving or removing it.</p>}<button type="button" className="outline-quiet outline-add-documents" data-outline-focus={`pick-${section.key}`} onClick={() => openPicker(section.key)}>+ Add documents</button></div>}
      </section>;
    })}
    {chapters.length > 0 && <div className={dropTarget === 'end' ? 'outline-drop' : ''}
      onDragOver={event => {
        if (drag.current?.kind !== 'chapter') return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget('end');
      }} onDrop={event => {
        if (drag.current?.kind !== 'chapter') return;
        event.preventDefault();
        change({ type: 'moveChapter', key: drag.current.key }, 'Chapter moved to the end.', `chapter-${drag.current.key}`);
        clearDrag();
      }}><button type="button" className="outline-add-chapter" onClick={() => setForm({ kind: 'add', title: '' })}>+ Add chapter</button></div>}
    <p className="outline-save-note">{connected ? 'Edits save automatically.' : 'Disconnected. Reconnect before building a manuscript.'}</p><span className="outline-sr-only" role="status" aria-live="polite">{announcement}</span>
    {form && <OutlineDialog title={form.kind === 'remove' ? `Remove “${form.title}”?` : form.kind === 'add' ? 'Add chapter' : 'Rename chapter'} onClose={() => setForm(null)}>{form.kind === 'remove' ? <><p>Removes this chapter, its {sections.find(s => s.key === form.key)?.references.length || 0} document links, and all text and nested sections in it from the outline. Original documents stay in your workspace.</p><div className="outline-actions"><button type="button" autoFocus onClick={() => setForm(null)}>Keep chapter</button><button type="button" className="outline-danger" onClick={() => { if (change({ type: 'removeChapter', key: form.key }, 'Chapter removed. Original documents kept.', 'add')) setForm(null); }}>Remove chapter</button></div></> : <form onSubmit={event => { event.preventDefault(); submitTitle(); }}><label className="outline-field">Chapter title<input autoFocus value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Name this chapter" /></label><div className="outline-actions"><button type="submit" className="outline-primary">{form.kind === 'add' ? 'Add chapter' : 'Save title'}</button><button type="button" onClick={() => setForm(null)}>Cancel</button></div></form>}</OutlineDialog>}
    {picker && <DocumentPicker chapter={picker.chapter} sections={sections} library={library} excluded={excluded} replace={!!picker.replace} initialSelection={picker.initial} onAdd={addPicked} onClose={() => { setPicker(null); setInitialBasket([]); }} />}
    {building && editor && <BuildOutlineDialog editor={editor} docId={docId} another={!!manuscript} beforeBuild={beforeBuild} onReview={onReview} onBuilt={filename => { setBuilding(false); onOpenSource(filename); }} onClose={() => setBuilding(false)} />}
  </div>;
}
