/** Block edits and canonical rejection, shared by active and background documents.
 * adr: adr/pending-overlay-model.md
 */
import { generateNodeId, LEAF_BLOCK_TYPES } from './helpers.js';
import { stripPendingAttrs } from './pending-overlay.js';
import type { PadDocument, NodeChange } from './state.js';

export function extractText(nodes: any[]): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.text) return node.text;
      if (node.content) return extractText(node.content);
      return '';
    })
    .join('\n');
}

/**
 * Compute linear text from a node's inline content array.
 * Matches the frontend's mapTextOffsetToPos: text chars + hardBreak=1 char.
 */
function linearText(content: any[]): string {
  if (!content) return '';
  let out = '';
  for (const child of content) {
    if (child.type === 'text' && typeof child.text === 'string') out += child.text;
    else if (child.type === 'hardBreak') out += '\n';
  }
  return out;
}

/**
 * Tokenize text into words with character offsets.
 */
function tokenize(text: string): Array<{ word: string; start: number; end: number }> {
  const words: Array<{ word: string; start: number; end: number }> = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text))) {
    words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return words;
}

/**
 * Compute sub-node selection range by word-level diff.
 * Finds first and last differing words → decoration spans that range.
 */
function computePartialRange(origContent: any[], newContent: any[]): {
  selectionFrom: number; selectionTo: number;
  originalFrom: number; originalTo: number;
} | null {
  const origText = linearText(origContent || []);
  const newText = linearText(newContent || []);
  if (!origText || !newText || origText === newText) return null;

  const origWords = tokenize(origText);
  const newWords = tokenize(newText);
  if (origWords.length === 0 || newWords.length === 0) return null;

  // First differing word from start
  let firstDiff = 0;
  while (firstDiff < origWords.length && firstDiff < newWords.length &&
    origWords[firstDiff].word === newWords[firstDiff].word) firstDiff++;

  // All words identical (shouldn't happen since text differs, but guard)
  if (firstDiff === origWords.length && firstDiff === newWords.length) return null;

  // Last differing word from end
  let origEnd = origWords.length - 1;
  let newEnd = newWords.length - 1;
  while (origEnd >= firstDiff && newEnd >= firstDiff &&
    origWords[origEnd].word === newWords[newEnd].word) {
    origEnd--;
    newEnd--;
  }

  // No common words at start or end → full rewrite, skip partial
  if (firstDiff === 0 && origEnd === origWords.length - 1 && newEnd === newWords.length - 1) return null;

  // Raw character offsets from first/last changed words
  let origFrom = firstDiff < origWords.length ? origWords[firstDiff].start : origText.length;
  let origTo = origEnd >= firstDiff && origEnd < origWords.length ? origWords[origEnd].end : origFrom;
  let newFrom = firstDiff < newWords.length ? newWords[firstDiff].start : newText.length;
  let newTo = newEnd >= firstDiff && newEnd < newWords.length ? newWords[newEnd].end : newFrom;

  // Snap start back to previous sentence boundary (after ". " or ".\n")
  const snapBack = (text: string, pos: number): number => {
    let i = pos - 1;
    while (i > 0) {
      if (text[i] === '.' && i + 1 < text.length && (text[i + 1] === ' ' || text[i + 1] === '\n')) return i + 2;
      i--;
    }
    return 0; // No period found → start of text
  };

  // Snap end forward to next sentence boundary (". " or ".\n" or end of text).
  // pos is exclusive, so start at its last character: a changed word that
  // ends its sentence ("hungry.") must stop there, not run on to the next
  // sentence (which made a one-sentence edit mark the rest of the paragraph).
  const snapForward = (text: string, pos: number): number => {
    let i = Math.max(0, pos - 1);
    while (i < text.length) {
      if (text[i] === '.' && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) return i + 1;
      i++;
    }
    return text.length;
  };

  origFrom = snapBack(origText, origFrom);
  origTo = snapForward(origText, origTo);
  newFrom = snapBack(newText, newFrom);
  newTo = snapForward(newText, newTo);

  // If almost everything changed, full-node decoration
  if ((origTo - origFrom + newTo - newFrom) >= (origText.length + newText.length) * 0.8) return null;

  return {
    selectionFrom: newFrom,
    selectionTo: newTo,
    originalFrom: origFrom,
    originalTo: origTo,
  };
}

/**
 * Containers whose internals are NOT addressable via MCP. `findNode` must not
 * descend into these — their child IDs are ephemeral (regenerated every
 * `markdownToTiptap` parse, untracked by the matcher) and never exposed via
 * `compactNodes`, so any agent-provided ID that happens to match a node inside
 * one is a collision, not a legitimate target.
 *
 * Before this guard existed, a `write_to_pad` rewrite could silently corrupt a
 * table cell: an agent ID collision with a freshly-minted table-internal node
 * routed the splice into the table instead of the intended top-level
 * paragraph. Reported as success, observable as stray paragraphs / mangled
 * rows in the saved markdown.
 *
 * Mirrors `node-blocks.ts`'s walker, which already treats tables as opaque.
 *
 * adr: adr/node-identity-matcher.md
 */
const OPAQUE_CONTAINER_TYPES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader']);

/**
 * Find a node by ID in any document tree.
 * topLevel is used to resolve the "end" sentinel.
 */
export function findNode(nodes: any[], id: string, topLevel: any[]): { parent: any[]; index: number } | null {
  if (id === 'end') {
    if (topLevel && topLevel.length > 0) {
      return { parent: topLevel, index: topLevel.length - 1 };
    }
    return null;
  }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].attrs?.id === id) {
      return { parent: nodes, index: i };
    }
    // Don't descend into table internals (table, tableRow, tableCell, tableHeader).
    // Their IDs aren't addressable via MCP and they regenerate on every parse,
    // so any match inside is a collision that would silently corrupt the table.
    if (OPAQUE_CONTAINER_TYPES.has(nodes[i].type)) continue;
    if (nodes[i].content && Array.isArray(nodes[i].content)) {
      const result = findNode(nodes[i].content, id, topLevel);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Core change application logic — operates on any document object.
 * Mutates doc in place and returns processed changes with server-assigned IDs.
 *
 * When `autoAccept` is true, changes commit directly: no pendingStatus tagging,
 * no pendingOriginalContent baseline, and deletes hard-remove from the array
 * (rather than tagging for review). Processed changes carry autoAccept: true
 * so the client knows to apply them as committed edits, not pending review.
 */
/**
 * The node as canonical holds it, with every pending proposal withdrawn — the
 * same result the user gets by rejecting them. Null when canonical has no such
 * node: a pending insert, or a rewrite with no recorded baseline. Keeps the
 * node's id so a review can still target it. adr: adr/pending-overlay-model.md
 */
function canonicalFormOf(node: any): any | null {
  const reverted = cloneWithPendingReverted({ type: 'doc', content: [node] }).content[0];
  return reverted ? { ...reverted, attrs: { ...reverted.attrs, id: node.attrs?.id } } : null;
}

export function applyChangesToDoc(doc: PadDocument, changes: NodeChange[], autoAccept: boolean = false, tweetContext: boolean = false): NodeChange[] {
  const processed: NodeChange[] = [];

  // Track last insert anchor → last inserted node ID, so consecutive inserts
  // with the same afterNodeId chain naturally (array order = document order).
  let lastInsertAnchor: string | null = null;
  let lastInsertedId: string | null = null;

  for (const change of changes) {
    if (change.operation === 'rewrite' && change.nodeId && change.content) {
      const found = findNode(doc.content, change.nodeId, doc.content);
      if (!found) continue;

      let contentArray = Array.isArray(change.content) ? change.content : [change.content];
      if (autoAccept) contentArray = contentArray.map(stripPendingAttrs);
      const originalNode = structuredClone(found.parent[found.index]);

      // Preserve target node type when plain text would otherwise demote it.
      // Markdown-it parses plain text as a paragraph, so rewriting a heading or
      // list item with plain prose silently changes the type. Two adaptations:
      //   - Block wrappers (listItem, blockquote) wrap the parsed paragraph as
      //     their child, keeping the wrapper's type and attrs.
      //   - Inline-content leaves (heading, codeBlock) take the paragraph's
      //     inline text and host it inside the original type, preserving level
      //     and other attrs.
      // Explicit markdown (e.g. "## Foo", "- bar") still wins because the
      // parser produces a matching node type before we get here.
      const targetType = originalNode.type;
      const parsedType = contentArray[0]?.type;
      const BLOCK_WRAPPERS = new Set(['listItem', 'blockquote']);
      const INLINE_LEAVES = new Set(['heading', 'codeBlock']);

      let isWrappedRewrite = false;
      if (parsedType === 'paragraph' && targetType !== 'paragraph') {
        if (BLOCK_WRAPPERS.has(targetType)) {
          contentArray = [{
            type: targetType,
            attrs: { ...originalNode.attrs },
            content: contentArray,
          }];
          isWrappedRewrite = true;
        } else if (INLINE_LEAVES.has(targetType)) {
          // Standard stamping handles the leaf case — heading/codeBlock are
          // themselves the decoration target, so no special branch needed below.
          contentArray = [{
            type: targetType,
            attrs: { ...originalNode.attrs },
            content: contentArray[0].content || [],
          }];
        }
      }

      // A rewrite's baseline is the node's canonical form: what reject restores
      // and what the .md body keeps. A pending proposal is never the baseline.
      // A pending insert has no canonical form, so rewriting it stays an insert.
      // Taking the node as found made the insert its own "original" and wrote
      // its unapproved text to disk. adr: adr/pending-overlay-model.md
      const baseline = canonicalFormOf(originalNode);

      // No canonical text (pending insert or empty node) → insert (green, not blue)
      const isEmptyNode = !baseline || !extractText(baseline.content || []).trim();

      // Detect partial change: if only a sub-range of the node text changed,
      // attach selection range attrs so the frontend decorates only that part.
      // For wrapped rewrites (listItem), compare paragraph content against the
      // listItem's inner paragraph so offsets align with what the user sees.
      let partialRange: ReturnType<typeof computePartialRange> = null;
      if (!isEmptyNode && contentArray.length === 1 && !autoAccept) {
        const baseContent = isWrappedRewrite
          ? (baseline.content?.[0]?.content || [])
          : (baseline.content || []);
        const newContent = isWrappedRewrite
          ? (contentArray[0].content?.[0]?.content || [])
          : (contentArray[0].content || []);
        partialRange = computePartialRange(baseContent, newContent);
      }

      // Build first node. For wrapped rewrites, pendingStatus and related attrs
      // belong on the inner leaf (paragraph) so the decoration renderer — which
      // keys off LEAF_BLOCK_TYPES — picks them up. The wrapper keeps the original
      // node's id/attrs so subsequent calls can still target it.
      let firstNode: any;
      if (isWrappedRewrite && !autoAccept) {
        const innerLeaf = contentArray[0].content?.[0] || { type: 'paragraph', content: [] };
        const innerWithPending = {
          ...innerLeaf,
          attrs: {
            ...innerLeaf.attrs,
            id: innerLeaf.attrs?.id || generateNodeId(),
            pendingStatus: isEmptyNode ? 'insert' : 'rewrite',
            pendingFeedback: change.feedback?.trim() || null,
            ...(isEmptyNode ? {} : { pendingOriginalContent: baseline }),
            ...(partialRange ? {
              pendingSelectionFrom: partialRange.selectionFrom,
              pendingSelectionTo: partialRange.selectionTo,
              pendingOriginalFrom: partialRange.originalFrom,
              pendingOriginalTo: partialRange.originalTo,
            } : {}),
          },
        };
        firstNode = {
          type: 'listItem',
          attrs: { ...contentArray[0].attrs, id: change.nodeId },
          content: [innerWithPending, ...contentArray[0].content.slice(1)],
        };
      } else {
        firstNode = {
          ...contentArray[0],
          attrs: autoAccept ? {
            ...contentArray[0].attrs,
            id: change.nodeId,
          } : {
            ...contentArray[0].attrs,
            id: change.nodeId,
            pendingStatus: isEmptyNode ? 'insert' : 'rewrite',
            pendingFeedback: change.feedback?.trim() || null,
            ...(isEmptyNode ? {} : { pendingOriginalContent: baseline }),
            ...(partialRange ? {
              pendingSelectionFrom: partialRange.selectionFrom,
              pendingSelectionTo: partialRange.selectionTo,
              pendingOriginalFrom: partialRange.originalFrom,
              pendingOriginalTo: partialRange.originalTo,
            } : {}),
          },
        };
      }

      // Additional nodes get inserted after — as pending inserts in normal mode,
      // as plain blocks in autoAccept mode.
      const extraNodes = contentArray.slice(1).map((node: any) => ({
        ...node,
        attrs: {
          ...node.attrs,
          id: node.attrs?.id || generateNodeId(),
        },
      }));
      if (!autoAccept) markLeafBlocksAsPending(extraNodes, 'insert', change.feedback);

      // Direct commits must not inherit an earlier proposal's review attributes.
      if (autoAccept) {
        firstNode = stripPendingAttrs(firstNode);
      }

      found.parent.splice(found.index, 1, firstNode, ...extraNodes);

      processed.push({
        ...change,
        content: [firstNode, ...extraNodes],
        ...(autoAccept ? { autoAccept: true } : {}),
      });
    }

    else if (change.operation === 'insert' && change.content) {
      const supplied = Array.isArray(change.content) ? change.content : [change.content];
      const contentArray = autoAccept ? supplied.map(stripPendingAttrs) : supplied;

      // Assign IDs to all new nodes before broadcast
      const contentWithIds = contentArray.map((node: any, i: number) => ({
        ...node,
        attrs: {
          ...node.attrs,
          id: node.attrs?.id || (change.nodeId && !change.afterNodeId && i === 0 ? change.nodeId : generateNodeId()),
        },
      }));
      // Mark leaf blocks as pending (not containers) — skipped in autoAccept mode
      // so inserts commit as plain content without decoration.
      if (!autoAccept) markLeafBlocksAsPending(contentWithIds, 'insert', change.feedback);

      let resolvedAfterId: string | undefined;

      // Auto-chain: if this insert targets the same anchor as the previous insert,
      // redirect it to insert after the last inserted node instead (preserves array order).
      let effectiveAfterId = change.afterNodeId;
      if (effectiveAfterId && effectiveAfterId === lastInsertAnchor && lastInsertedId) {
        effectiveAfterId = lastInsertedId;
      }

      if (change.nodeId && !change.afterNodeId) {
        // Replace empty node
        const found = findNode(doc.content, change.nodeId, doc.content);
        if (!found) continue;
        found.parent.splice(found.index, 1, ...contentWithIds);
      } else if (effectiveAfterId) {
        const found = findNode(doc.content, effectiveAfterId, doc.content);
        if (!found) continue;
        // Resolve "end" sentinel to actual node ID so browser can find it
        resolvedAfterId = found.parent[found.index]?.attrs?.id;
        found.parent.splice(found.index + 1, 0, ...contentWithIds);
      } else {
        continue;
      }

      // Track for auto-chaining: remember original anchor + last inserted ID
      const newLastId = contentWithIds[contentWithIds.length - 1]?.attrs?.id;
      if (change.afterNodeId && newLastId) {
        if (change.afterNodeId !== lastInsertAnchor) {
          // New anchor — start fresh chain
          lastInsertAnchor = change.afterNodeId;
        }
        lastInsertedId = newLastId;
      }

      // Broadcast with server-assigned IDs and resolved anchor so browser inserts at the correct position
      processed.push({
        ...change,
        afterNodeId: resolvedAfterId && change.afterNodeId === 'end'
          ? resolvedAfterId
          : effectiveAfterId ?? change.afterNodeId,
        content: contentWithIds.length === 1 ? contentWithIds[0] : contentWithIds,
        ...(autoAccept ? { autoAccept: true } : {}),
      });
    }

    else if (change.operation === 'delete' && change.nodeId) {
      const found = findNode(doc.content, change.nodeId, doc.content);
      if (!found) continue;

      // Tweet thread: hard-delete paragraphs + adjacent HR immediately.
      // Tweet compose view can't handle pending deletes near HRs — hard-delete and resync.
      const delNode = found.parent[found.index];
      const hardDeleteTypes = ['paragraph', 'image', 'imageLoading'];
      if (hardDeleteTypes.includes(delNode.type) && tweetContext) {
        const idx = found.index;
        if (idx > 0 && found.parent[idx - 1].type === 'horizontalRule') {
          found.parent.splice(idx, 1);
          found.parent.splice(idx - 1, 1);
        } else if (idx + 1 < found.parent.length && found.parent[idx + 1].type === 'horizontalRule') {
          found.parent.splice(idx + 1, 1);
          found.parent.splice(idx, 1);
        } else {
          found.parent.splice(idx, 1);
        }
        // Push a synthetic HR change so ws.ts detects it and sends document-switched
        processed.push({ operation: 'delete' as const, nodeId: change.nodeId, content: [{ type: 'horizontalRule' }] });
        continue;
      }

      if (autoAccept) {
        // Hard-delete: remove the node entirely from its parent array.
        found.parent.splice(found.index, 1);
        processed.push({ ...change, autoAccept: true });
      } else {
        // A delete targets the node's canonical form. Any pending proposal on
        // the node is withdrawn first; only what remains is marked for review.
        // A pending insert has no canonical form, so withdrawing it removes
        // the node outright. Marking it 'delete' instead kept it in canonical
        // and wrote the unapproved text to disk. adr: adr/pending-overlay-model.md
        const canonicalNode = canonicalFormOf(found.parent[found.index]);
        if (canonicalNode) {
          found.parent[found.index] = {
            ...canonicalNode,
            attrs: { ...canonicalNode.attrs, pendingStatus: 'delete', pendingFeedback: change.feedback?.trim() || null },
          };
        } else {
          found.parent.splice(found.index, 1);
        }
        processed.push(change);
      }
    }
  }

  return processed;
}

export function cloneWithPendingReverted(doc: PadDocument): PadDocument {
  const PENDING_KEYS = ['pendingStatus', 'pendingOriginalContent', 'pendingGroupId', 'pendingFeedback', 'pendingTextEdits', 'pendingSelectionFrom', 'pendingSelectionTo', 'pendingOriginalFrom', 'pendingOriginalTo', 'pendingOrphan', 'pendingStaleBaseline'];
  function clean(node: any): any {
    const clone = JSON.parse(JSON.stringify(node));
    if (clone.attrs) {
      for (const k of PENDING_KEYS) delete clone.attrs[k];
    }
    if (clone.content) clone.content = walk(clone.content);
    return clone;
  }
  function walk(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      const status = node.attrs?.pendingStatus;
      if (status === 'insert') continue; // drop fresh agent inserts
      if (status === 'rewrite') {
        const original = node.attrs?.pendingOriginalContent;
        if (original) result.push(clean(original));
        // If no original stashed, drop the node — we have nothing to revert to.
        continue;
      }
      // 'delete' status or no status: keep the node, strip any pending attrs.
      result.push(clean(node));
    }
    return result;
  }
  return { type: 'doc', content: walk(doc.content || []) };
}

/**
 * Mark leaf block nodes as pending within a node array.
 * Only marks text-containing blocks (paragraph, heading, codeBlock, etc.)
 * NOT container nodes (bulletList, orderedList, listItem, blockquote).
 * Used by `applyChangesToDoc` for write_to_pad inserts where containers
 * are handled by the explicit firstNode top-level mark.
 */
function markLeafBlocksAsPending(nodes: any[], status: string, feedback?: string): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type && LEAF_BLOCK_TYPES.has(node.type)) {
      node.attrs = { ...node.attrs, pendingStatus: status, pendingFeedback: feedback?.trim() || null };
      if (!node.attrs.id) {
        node.attrs.id = generateNodeId();
      }
    } else if (node.content) {
      markLeafBlocksAsPending(node.content, status, feedback);
    }
  }
}
