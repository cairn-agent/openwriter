/**
 * The text a context-menu panel or prompt will act on, kept marked while it is open. Typing in
 * the panel takes focus from the editor, and with it the selection's highlight, so without this
 * the writer can no longer see what is about to change.
 */
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const menuTargetKey = new PluginKey<DecorationSet>('menuTarget');

/** Mark from..to in the editor; the returned function takes the mark away. */
export function markMenuTarget(editor: Editor, from: number, to: number): () => void {
  if (editor.isDestroyed || from >= to) return () => {};
  editor.unregisterPlugin(menuTargetKey);
  editor.registerPlugin(new Plugin<DecorationSet>({
    key: menuTargetKey,
    state: {
      init: (_, state) => DecorationSet.create(state.doc, [Decoration.inline(from, to, { class: 'context-menu-target' })]),
      apply: (tr, set) => set.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => menuTargetKey.getState(state) },
  }));
  return () => { if (!editor.isDestroyed) editor.unregisterPlugin(menuTargetKey); };
}

/** Where the marked text is on screen: the panel goes beside it, never over it. */
export function targetRect(editor: Editor, from: number, to: number): { top: number; bottom: number; left: number } | null {
  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to, -1);
    return { top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom), left: start.left };
  } catch {
    return null;
  }
}
