/**
 * ProseMirror plugin: marks a paragraph a sync replaced with another device's
 * newer version, with a notice under it: "Updated from Maya's laptop, 3:12 PM ·
 * Undo · See earlier version". Paragraphs are found by their text (the sync
 * works on the saved markdown, which has no node ids). Same module-state
 * pattern as the backlinks plugin. adr: adr/two-way-sync.md
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface ReplacedNotice {
  id: string;
  device: string;
  time: string;
  kept?: string[];
  earlier?: string[];
  anchor?: string;
}

export const syncNoticeKey = new PluginKey('syncNotice');

let notices: ReplacedNotice[] = [];
let onUndo: (id: string) => void = () => {};

export function setSyncNotices(list: ReplacedNotice[], undo: (id: string) => void): void {
  notices = list;
  onUndo = undo;
}

/** A markdown line as the editor shows it: no emphasis marks, link targets or block markers. */
function plain(md: string): string {
  return md
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();
}

export function noticeTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function noticeDom(n: ReplacedNotice): HTMLElement {
  const box = document.createElement('div');
  box.className = 'sync-notice';
  box.contentEditable = 'false';
  const line = document.createElement('div');
  const what = n.kept?.length ? 'Updated' : 'Removed';
  line.append(`${what} from ${n.device}, ${noticeTime(n.time)} · `);
  const undo = document.createElement('button');
  undo.textContent = 'Undo';
  undo.addEventListener('mousedown', (e) => { e.preventDefault(); onUndo(n.id); });
  const see = document.createElement('button');
  see.textContent = 'See earlier version';
  const earlier = document.createElement('div');
  earlier.className = 'sync-notice-earlier';
  earlier.hidden = true;
  earlier.textContent = (n.earlier || []).map(plain).join('\n\n');
  see.addEventListener('mousedown', (e) => {
    e.preventDefault();
    earlier.hidden = !earlier.hidden;
    see.textContent = earlier.hidden ? 'See earlier version' : 'Hide earlier version';
  });
  line.append(undo, ' · ', see);
  box.append(line, earlier);
  return box;
}

function build(doc: any): DecorationSet {
  if (notices.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const n of notices) {
    const targets = new Set((n.kept?.length ? n.kept : n.anchor ? [n.anchor] : []).map(plain));
    let last = -1;
    doc.descendants((node: any, pos: number) => {
      if (!node.isTextblock) return true;
      if (!targets.has(node.textContent.trim())) return false;
      if (n.kept?.length) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'sync-replaced' }));
      last = pos + node.nodeSize;
      return false;
    });
    if (last >= 0) decorations.push(Decoration.widget(last, () => noticeDom(n), { key: n.id, side: 1 }));
  }
  return DecorationSet.create(doc, decorations);
}

export function createSyncNoticePlugin(): Plugin {
  return new Plugin({
    key: syncNoticeKey,
    state: {
      init(_, state) { return build(state.doc); },
      apply(tr, old, _oldState, newState) {
        if (tr.docChanged || tr.getMeta('forceSyncNoticeUpdate')) return build(newState.doc);
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}

export function forceSyncNoticeRefresh(view: any): void {
  view.dispatch(view.state.tr.setMeta('forceSyncNoticeUpdate', true));
}
