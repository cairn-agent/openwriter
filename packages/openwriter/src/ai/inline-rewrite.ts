/**
 * The built-in Rewrite: send the selection to /api/ai/inline-edit. The server
 * calls Claude with the writer's own key and writes the result as a pending
 * change, which arrives in this editor like any agent edit for accept or reject.
 */
import type { Editor } from '@tiptap/react';
import { showToast } from '../utils/toast';
import { buildSelectionPayload } from './selection-payload';
import { inlineEdit, OPEN_KEY_SETTINGS_EVENT, type ModelChoice } from './ai-api';

const MAX_SELECTION_WORDS = 5000;

export async function requestInlineRewrite(opts: {
  editor: Editor;
  docId: string | undefined;
  selection: { from: number; to: number; nodes: any[]; nodeIds: string[] };
  instruction?: string;
  model: ModelChoice;
}): Promise<void> {
  const { editor, docId, selection } = opts;
  if (!docId || selection.nodeIds.length === 0) {
    showToast('Select some text in a document first.', 'error');
    return;
  }
  const payload = buildSelectionPayload(editor, selection);
  if (payload.words > MAX_SELECTION_WORDS) {
    showToast(`Selection too large: ${payload.words.toLocaleString()} words (max ${MAX_SELECTION_WORDS.toLocaleString()}). Select a smaller section.`, 'error');
    return;
  }

  const loadingId = `rewrite-${Date.now()}`;
  const $from = editor.state.doc.resolve(selection.from);
  const $to = editor.state.doc.resolve(selection.to);
  editor.commands.applyLoadingEffect(loadingId, selection.from, selection.to, $from.sameParent($to) ? 'selection' : 'paragraph');
  try {
    await inlineEdit({
      docId,
      nodeIds: selection.nodeIds,
      nodes: payload.markedNodes,
      contextBefore: payload.contextBefore,
      contextAfter: payload.contextAfter,
      instruction: opts.instruction?.trim() || undefined,
      model: opts.model,
    });
  } catch (err: any) {
    if (err?.code === 'no_key' || err?.code === 'key_rejected') {
      showToast(err.message, 'error', 9000, {
        label: 'Add key',
        onClick: () => window.dispatchEvent(new CustomEvent(OPEN_KEY_SETTINGS_EVENT)),
      });
    } else {
      showToast(err?.message || 'The rewrite failed.', 'error');
    }
  } finally {
    editor.commands.removeLoadingEffect(loadingId);
  }
}
