/**
 * What a rewrite of the selected text sends: the selected nodes (a partial
 * selection marked with [[START_SELECTION]] / [[END_SELECTION]]), nearby
 * paragraphs for flow, and the whole document's text. Shared by the Author's
 * Voice plugin actions and the built-in Rewrite.
 */
import type { Editor } from '@tiptap/react';
import { injectSelectionMarkers } from '../context-menu/selection-markers';

export interface SelectionPayload {
  markedNodes: any[];
  isSubParagraph: boolean;
  contextBefore: string[];
  contextAfter: string[];
  fullDocument: string;
  /** Words in the selected nodes (for the size guard). */
  words: number;
}

export function buildSelectionPayload(
  editor: Editor,
  selection: { from: number; to: number; nodes: any[]; nodeIds: string[] },
): SelectionPayload {
  const { from, to, nodes, nodeIds } = selection;
  const nodesBefore: string[] = [];
  const nodesAfter: string[] = [];
  const targetIdSet = new Set(nodeIds);
  let pastTarget = false;

  // Iterate top-level doc children only — collect plain text
  const doc = editor.state.doc;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const childId = child.attrs?.id;
    if (childId && targetIdSet.has(childId)) {
      pastTarget = true;
    } else if (!pastTarget) {
      const text = child.textContent.trim();
      if (text) nodesBefore.push(text);
    } else {
      const text = child.textContent.trim();
      if (text) nodesAfter.push(text);
    }
  }

  // Sub-paragraph selection: inject [[START_SELECTION]]/[[END_SELECTION]] markers
  // so the AI only modifies the selected text
  let markedNodes = nodes;
  let isSubParagraph = false;
  const $from = from !== to ? doc.resolve(from) : null;
  const $to = from !== to ? doc.resolve(to) : null;
  const sameBlock = $from && $to ? $from.sameParent($to) : false;
  if (sameBlock && $from && nodes.length === 1) {
    const contentStart = $from.start($from.depth);
    const startOffset = from - contentStart;
    const endOffset = to - contentStart;
    const nodeTextLength = nodes[0]?.content
      ?.reduce((len: number, c: any) => len + (c.text?.length || (c.type === 'hardBreak' ? 1 : 0)), 0) ?? 0;
    // Only inject markers for partial selections (not full paragraph)
    if (startOffset > 0 || endOffset < nodeTextLength) {
      markedNodes = injectSelectionMarkers(nodes, startOffset, endOffset);
      isSubParagraph = true;
    }
  }

  const selectionText = (nodes || [])
    .map((n: any) => (Array.isArray(n?.content) ? n.content.map((p: any) => p?.text || '').join(' ') : ''))
    .join(' ');

  return {
    markedNodes,
    isSubParagraph,
    contextBefore: nodesBefore.slice(-3),
    contextAfter: nodesAfter.slice(0, 3),
    fullDocument: doc.textContent,
    words: (selectionText.match(/\S+/g) || []).length,
  };
}
