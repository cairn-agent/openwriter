/**
 * Accept and Reject beside a pending change, where the writer is looking: under the change the
 * caret is in. A change the writer just asked for from the editor (Enhance and the other
 * right-click actions, or a plugin's own writing action through `app.showPending`) puts the
 * caret at its end when it lands, so its bar shows at once; the changes asked for together are
 * accepted or rejected together. The Review tab stays the place to step through every change.
 * adr: adr/pending-overlay-model.md
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { findNodeById } from '../decorations/apply';
import './pending-change-bar.css';

/** Fired on window when changes the writer asked for are on their way: `detail.nodeIds`. */
export const PENDING_REQUESTED_EVENT = 'ow-pending-write-applied';

const s = { strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const Check = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" {...s} /></svg>;
const XIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" {...s} /></svg>;

/** The pending block the caret is in, by id. */
function pendingAtCaret(editor: Editor): string | null {
  const { $head } = editor.state.selection;
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (node.attrs?.pendingStatus && node.attrs?.id) return node.attrs.id;
  }
  return null;
}

function isPending(editor: Editor, nodeId: string): boolean {
  return !!findNodeById(editor, nodeId)?.node.attrs?.pendingStatus;
}

interface Target { nodeIds: string[]; top: number; left: number }

export default function PendingChangeBar({ editor, onResolve }: {
  editor: Editor | null;
  /** Accept or reject one change by node id, through the app's own review path. */
  onResolve: (action: 'accept' | 'reject', nodeId: string) => void;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  // Changes the writer asked for together: waiting to land, then resolved as one.
  const asked = useRef<string[] | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    if (!editor || editor.isDestroyed) { setTarget(null); return; }
    const at = pendingAtCaret(editor);
    if (!at) { setTarget(null); return; }
    const batch = asked.current?.includes(at) ? asked.current.filter((id) => isPending(editor, id)) : [at];
    // Under the last block of the change, lined up with its left edge.
    let bottom = -Infinity;
    let left = Infinity;
    for (const id of batch) {
      const found = findNodeById(editor, id);
      const dom = found ? editor.view.nodeDOM(found.pos) : null;
      if (!(dom instanceof HTMLElement)) continue;
      const r = dom.getBoundingClientRect();
      bottom = Math.max(bottom, r.bottom);
      left = Math.min(left, r.left);
    }
    if (!Number.isFinite(bottom)) { setTarget(null); return; }
    setTarget((prev) => prev && prev.top === bottom && prev.left === left && prev.nodeIds.join() === batch.join()
      ? prev : { nodeIds: batch, top: bottom, left });
  }, [editor]);

  // A requested change that has landed: caret to its end (no scroll, no focus), so its bar shows.
  const placeCaret = useCallback(() => {
    const ids = asked.current;
    if (!editor || editor.isDestroyed || !ids) return;
    const first = ids.map((id) => findNodeById(editor, id)).find((f) => f?.node.attrs?.pendingStatus && f.node.isTextblock);
    if (!first) return;
    const end = first.pos + first.node.nodeSize - 1;
    if (editor.state.selection.empty && editor.state.selection.head === end) return;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).setMeta('addToHistory', false));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let landed = false;
    const onTransaction = () => {
      if (asked.current && !landed && asked.current.some((id) => isPending(editor, id))) {
        landed = true;
        setTimeout(placeCaret, 0);
      }
      measure();
    };
    const onAsked = (e: Event) => {
      const ids = (e as CustomEvent).detail?.nodeIds;
      if (!Array.isArray(ids) || ids.length === 0) return;
      asked.current = ids;
      landed = false;
      onTransaction();
    };
    // The writer moving on (clicking or typing in the editor) ends the wait for a requested change.
    const onWriter = () => { if (!landed) asked.current = null; };
    const dom = editor.view.dom;
    editor.on('transaction', onTransaction);
    window.addEventListener(PENDING_REQUESTED_EVENT, onAsked);
    dom.addEventListener('mousedown', onWriter);
    dom.addEventListener('keydown', onWriter);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      editor.off('transaction', onTransaction);
      window.removeEventListener(PENDING_REQUESTED_EVENT, onAsked);
      dom.removeEventListener('mousedown', onWriter);
      dom.removeEventListener('keydown', onWriter);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [editor, measure, placeCaret]);

  // Keep the bar on screen: above the change when there is no room below it.
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || !target) return;
    setFlip(target.top + 6 + el.offsetHeight > window.innerHeight - 8);
  }, [target]);

  if (!target || !editor) return null;

  const resolve = (action: 'accept' | 'reject') => {
    for (const id of target.nodeIds) onResolve(action, id);
    asked.current = null;
    editor.commands.focus();
  };
  const top = flip ? Math.max(8, target.top - 6) : target.top + 6;

  return (
    <div
      ref={barRef}
      className="pending-change-bar"
      role="group"
      aria-label="Suggested change"
      style={{ top, left: Math.max(8, target.left), transform: flip ? 'translateY(-100%)' : undefined }}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); editor.commands.focus(); } }}
    >
      <span className="pending-change-bar__label">Suggested change</span>
      <button type="button" className="pending-change-bar__btn pending-change-bar__btn--accept" onClick={() => resolve('accept')}>
        <Check /><span>Accept</span>
      </button>
      <button type="button" className="pending-change-bar__btn pending-change-bar__btn--reject" onClick={() => resolve('reject')}>
        <XIcon /><span>Reject</span>
      </button>
    </div>
  );
}
