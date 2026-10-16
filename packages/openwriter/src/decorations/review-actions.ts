/**
 * Review actions shared by every review presentation: the Review tab, Focus mode, and a
 * client plugin's own review UI (src/plugins/client-plugins.tsx). Showing a rewrite's
 * original in place, and telling the server once a document has nothing left to review.
 * adr: adr/pending-overlay-model.md
 */

import type { Editor } from '@tiptap/react';
import { setPreviewState, isPreviewActive, getSavedModifiedContent, getPreviewGroupId } from './plugin';
import { findNodeById, findGroupMembers } from './apply';
import { derivePendingState } from '../hooks/usePendingState';

function replaceNodeContent(editor: Editor, nodeId: string, newContent: any): boolean {
  const result = findNodeById(editor, nodeId);
  if (!result) return false;
  const { pos, node } = result;
  const replacement = {
    type: newContent.type || node.type.name,
    attrs: {
      ...(newContent.attrs || {}),
      id: node.attrs.id,
      pendingStatus: node.attrs.pendingStatus,
      pendingOriginalContent: node.attrs.pendingOriginalContent,
      pendingFeedback: node.attrs.pendingFeedback,
      pendingSelectionFrom: node.attrs.pendingSelectionFrom,
      pendingSelectionTo: node.attrs.pendingSelectionTo,
      pendingOriginalFrom: node.attrs.pendingOriginalFrom,
      pendingOriginalTo: node.attrs.pendingOriginalTo,
    },
    content: newContent.content,
  };
  try {
    editor.chain()
      .command(({ tr }) => { tr.setMeta('addToHistory', false); return true; })
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, replacement)
      .run();
    return true;
  } catch { return false; }
}

function replaceGroupRange(editor: Editor, groupId: string, newContent: any[]): boolean {
  const members = findGroupMembers(editor, groupId);
  if (members.length === 0) return false;
  const rangeFrom = members[0].pos;
  const rangeTo = members[members.length - 1].pos + members[members.length - 1].node.nodeSize;
  try {
    editor.chain()
      .command(({ tr }) => { tr.setMeta('addToHistory', false); return true; })
      .deleteRange({ from: rangeFrom, to: rangeTo })
      .insertContentAt(rangeFrom, newContent)
      .run();
    return true;
  } catch { return false; }
}

/**
 * Swap a pending rewrite (or rewrite group) to its original text in place. The swap stays
 * out of undo history and out of autosave (isPreviewActive); showModified puts it back.
 */
export function showOriginal(editor: Editor, change: { nodeId: string; groupId?: string }): boolean {
  if (change.groupId) {
    const members = findGroupMembers(editor, change.groupId);
    if (members.length === 0) return false;
    const originalContent = members[0].node.attrs?.pendingOriginalContent;
    if (!originalContent || !Array.isArray(originalContent)) return false;
    const modifiedJsons = members.map((m) => m.node.toJSON());
    const previewNodes = originalContent.map((orig: any, i: number) => ({
      ...orig,
      attrs: {
        ...(orig.attrs || {}),
        pendingStatus: 'rewrite',
        pendingGroupId: change.groupId,
        pendingFeedback: members[0].node.attrs.pendingFeedback,
        ...(i === 0 ? { pendingOriginalContent: originalContent } : {}),
      },
    }));
    setPreviewState(true, change.nodeId, modifiedJsons, change.groupId);
    if (!replaceGroupRange(editor, change.groupId, previewNodes)) { setPreviewState(false); return false; }
    return true;
  }
  const result = findNodeById(editor, change.nodeId);
  const originalContent = result?.node.attrs?.pendingOriginalContent;
  if (!result || !originalContent) return false;
  setPreviewState(true, change.nodeId, result.node.toJSON());
  if (!replaceNodeContent(editor, change.nodeId, originalContent)) { setPreviewState(false); return false; }
  return true;
}

/** End an original preview started by showOriginal. False when none was showing. */
export function showModified(editor: Editor, previewingNodeId: string | null): boolean {
  if (!isPreviewActive() || !previewingNodeId) return false;
  const modified = getSavedModifiedContent();
  const groupId = getPreviewGroupId();
  if (groupId && modified && Array.isArray(modified)) {
    replaceGroupRange(editor, previewingNodeId, modified);
  } else if (modified) {
    replaceNodeContent(editor, previewingNodeId, modified);
  }
  setPreviewState(false);
  return true;
}

/**
 * After an accept or reject: once no editor holds a pending change, save the document and
 * tell the server the review is over (it clears the doc's pending state and, on accept,
 * records the commit).
 */
export function settleIfResolved(opts: {
  editors: Editor[];
  filename: string;
  action: 'accept' | 'reject';
  getDocument?: () => any;
  sendMessage: (msg: any) => boolean | void;
  version: number;
}): void {
  const { editors, filename, action, getDocument, sendMessage, version } = opts;
  if (!filename) return;
  const hasRemaining = editors.some((e) => e && !e.isDestroyed && derivePendingState(e).length > 0);
  if (hasRemaining) return;
  const doc = getDocument?.();
  if (doc) sendMessage({ type: 'doc-update', document: doc, filename, version });
  sendMessage({ type: 'pending-resolved', filename, action });
}
