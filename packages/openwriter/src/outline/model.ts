/** The outline is the live editor document, never a second collection model.
 * Moves preserve slices (including notes, nested headings and node IDs).
 * adr: adr/outline-editor.md */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

export interface OutlineReference {
  key: string; docId: string; label: string; href: string;
  from: number; to: number; blockFrom: number; blockTo: number;
  wholeBlock: boolean; pending: boolean;
}
export interface OutlineSection {
  key: string; title: string; from: number; to: number; headingPos?: number;
  level: number; pending: boolean; hasOtherContent: boolean;
  references: OutlineReference[];
  subheadings: { title: string; level: number; pos: number }[];
}
export type OutlineAction =
  | { type: 'addChapter'; title: string; after?: string }
  | { type: 'renameChapter'; key: string; title: string }
  | { type: 'removeChapter'; key: string }
  | { type: 'moveChapter'; key: string; before?: string }
  | { type: 'addDocuments'; chapter: string; documents: { docId: string; title: string }[] }
  | { type: 'removeReference'; key: string }
  | { type: 'moveReference'; key: string; chapter: string; before?: string }
  | { type: 'replaceReference'; key: string; docId: string; title: string };

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const referenceId = (href: string) => /^doc:([a-f0-9]{8})(?:[#?].*)?$/i.exec(href)?.[1].toLowerCase();

export function readOutline(doc: ProseMirrorNode): OutlineSection[] {
  const sections: OutlineSection[] = [];
  let section: OutlineSection = { key: 'intro', title: 'Before chapter 1', from: 0, to: 0, level: 0, pending: false, hasOtherContent: false, references: [], subheadings: [] };
  doc.forEach((block, pos) => {
    if (block.type.name === 'heading' && block.attrs.level <= 2) {
      section.to = pos;
      if (section.headingPos !== undefined || section.references.length || section.hasOtherContent) sections.push(section);
      section = { key: block.attrs.id || `heading:${pos}`, title: block.textContent, from: pos, to: doc.content.size, headingPos: pos, level: block.attrs.level, pending: false, hasOtherContent: false, references: [], subheadings: [] };
    }
    const scan = (node: ProseMirrorNode, at: number, depth: number, inheritedPending: boolean) => {
      const pending = inheritedPending || !!node.attrs.pendingStatus;
      if (pending) section.pending = true;
      if (node.type.name === 'heading' && at !== section.headingPos) {
        section.subheadings.push({ title: node.textContent, level: node.attrs.level, pos: at });
      }
      if (node.isTextblock) {
        let run: OutlineReference | null = null;
        let ordinal = 0;
        node.forEach((inline, offset) => {
          const href = String(inline.marks.find(m => m.type.name === 'link')?.attrs.href || '');
          const docId = referenceId(href);
          const from = at + 1 + offset;
          if (docId && inline.isText) {
            if (run && run.href === href && run.to === from) {
              run.to += inline.nodeSize; run.label += inline.text || '';
            } else {
              run = { key: `${node.attrs.id || `block:${at}`}:${ordinal++}:${docId}`, docId, label: inline.text || '', href, from, to: from + inline.nodeSize, blockFrom: at, blockTo: at + node.nodeSize, wholeBlock: false, pending };
              section.references.push(run);
            }
          } else {
            run = null;
            if (at !== section.headingPos && (inline.textContent.trim() || !inline.isText)) section.hasOtherContent = true;
          }
        });
        for (const ref of section.references.filter(r => r.blockFrom === at)) {
          ref.wholeBlock = depth === 0 && node.type.name === 'paragraph' && ref.from === at + 1 && ref.to === at + node.nodeSize - 1;
        }
      } else {
        if (node.isLeaf) section.hasOtherContent = true;
        node.forEach((child, offset) => scan(child, at + 1 + offset, depth + 1, pending));
      }
    };
    scan(block, pos, 0, false);
  });
  section.to = doc.content.size;
  if (section.headingPos !== undefined || section.references.length || section.hasOtherContent) sections.push(section);
  return sections;
}

function editable(state: EditorState, from: number, to: number) {
  let pending = false;
  state.doc.nodesBetween(from, to, n => { if (n.attrs.pendingStatus) pending = true; });
  const resolved = state.doc.resolve(Math.min(from, state.doc.content.size));
  for (let d = 1; d <= resolved.depth; d++) if (resolved.node(d).attrs.pendingStatus) pending = true;
  if (pending) throw new Error('Review the pending changes in this part of the outline before changing its structure.');
}

/** Resolve identity from the current state at action time, never from stale positions. */
export function outlineTransaction(state: EditorState, action: OutlineAction): Transaction {
  const sections = readOutline(state.doc);
  const getSection = (key: string) => {
    if (key === 'intro' && !sections.some(s => s.key === key)) return { key, title: 'Before chapter 1', from: 0, to: sections[0]?.from ?? state.doc.content.size, level: 0, pending: false, hasOtherContent: false, references: [], subheadings: [] } as OutlineSection;
    const section = sections.find(s => s.key === key);
    if (!section) throw new Error('That chapter changed or was removed. Choose a chapter again.');
    return section;
  };
  const getRef = (key: string) => {
    const ref = sections.flatMap(s => s.references).find(r => r.key === key);
    if (!ref) throw new Error('That document link changed. Choose it again.');
    return ref;
  };
  const title = (value: string) => {
    if (!value.trim()) throw new Error('Name this chapter.');
    return value.trim();
  };
  const tr = closeHistory(state.tr);
  const move = (from: number, to: number, destination: number) => {
    if (destination >= from && destination <= to) return;
    editable(state, from, to);
    const slice = state.doc.slice(from, to);
    tr.delete(from, to).insert(tr.mapping.map(destination), slice.content);
  };
  if (action.type === 'addChapter') {
    const after = action.after ? getSection(action.after) : null;
    if (after?.pending) throw new Error('Review this chapter before inserting a chapter after it.');
    const at = after?.to ?? state.doc.content.size;
    tr.insert(at, state.schema.nodes.heading.create({ level: 2, id: newId() }, state.schema.text(title(action.title))));
  } else if (action.type === 'renameChapter') {
    const section = getSection(action.key);
    if (section.headingPos === undefined) throw new Error('Opening material does not have a chapter heading.');
    const node = state.doc.nodeAt(section.headingPos)!;
    editable(state, section.headingPos, section.headingPos + node.nodeSize);
    tr.replaceWith(section.headingPos + 1, section.headingPos + node.nodeSize - 1, state.schema.text(title(action.title)));
  } else if (action.type === 'removeChapter' || action.type === 'moveChapter') {
    const section = getSection(action.key);
    if (section.headingPos === undefined) throw new Error('Opening material stays before chapter 1.');
    editable(state, section.from, section.to);
    if (action.type === 'removeChapter') tr.deleteRange(section.from, section.to);
    else {
      const destination = action.before ? getSection(action.before) : null;
      if (destination?.key === 'intro') throw new Error('Chapters follow the opening material.');
      if (destination?.pending) throw new Error('Review the destination chapter before moving here.');
      move(section.from, section.to, destination?.from ?? state.doc.content.size);
    }
  } else if (action.type === 'addDocuments') {
    const section = getSection(action.chapter);
    if (section.pending) throw new Error('Review this chapter before adding documents. Your selection is kept.');
    const seen = new Set(section.references.map(r => r.docId));
    const nodes = action.documents.map(d => {
      if (!/^[a-f0-9]{8}$/i.test(d.docId)) throw new Error('Choose a document from the list.');
      if (seen.has(d.docId)) throw new Error(`“${d.title}” is already in this chapter. Update your selection.`);
      seen.add(d.docId);
      return state.schema.nodes.paragraph.create({ id: newId() }, state.schema.text(d.title.trim() || 'Untitled', [state.schema.marks.link.create({ href: `doc:${d.docId}` })]));
    });
    if (nodes.length) tr.insert(section.to, nodes);
  } else {
    const ref = getRef(action.key);
    editable(state, ref.blockFrom, ref.blockTo);
    const from = ref.wholeBlock ? ref.blockFrom : ref.from;
    const to = ref.wholeBlock ? ref.blockTo : ref.to;
    if (action.type === 'removeReference') tr.deleteRange(from, to);
    else if (action.type === 'replaceReference') {
      if (!/^[a-f0-9]{8}$/i.test(action.docId)) throw new Error('Choose a document from the list.');
      const marks = state.doc.resolve(ref.from).marks().filter(m => m.type.name !== 'link');
      marks.push(state.schema.marks.link.create({ href: `doc:${action.docId}` }));
      tr.replaceWith(ref.from, ref.to, state.schema.text(action.title || 'Untitled', marks));
    } else {
      const destination = getSection(action.chapter);
      if (destination.pending) throw new Error('Review the destination chapter before moving here.');
      const before = action.before ? getRef(action.before) : null;
      if (before && !destination.references.some(r => r.key === before.key)) throw new Error('The destination changed. Choose it again.');
      const at = before?.blockFrom ?? destination.to;
      if (before?.key !== ref.key) {
        if (ref.wholeBlock) move(from, to, at);
        else {
          // A link embedded in prose moves as its own paragraph; surrounding prose stays.
          const content = state.doc.slice(ref.from, ref.to).content;
          tr.delete(ref.from, ref.to);
          tr.insert(tr.mapping.map(at), state.schema.nodes.paragraph.create({ id: newId() }, content));
        }
      }
    }
  }
  const retained = new Set<string>();
  tr.doc.forEach(n => { if (n.attrs.id) retained.add(n.attrs.id); });
  const removed: string[] = [];
  state.doc.forEach(n => { if (n.attrs.id && !retained.has(n.attrs.id)) removed.push(n.attrs.id); });
  if (removed.length) tr.setMeta('outlineRemovedIds', removed);
  return tr;
}
