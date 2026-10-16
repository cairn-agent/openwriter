/** A save barrier observes the existing write path; it never writes a second
 * browser snapshot. The caller sends it after doc-update on the same socket.
 * adr: adr/outline-editor.md */
import { getDocId, getDocument, getCanonical, getOverlayEntries, isAgentLocked, save, cancelDebouncedSave } from './state.js';
import { getActiveFilename } from './documents.js';
import { loadOverlay, extractOverlay } from './pending-overlay.js';
import { readFrontmatter } from './backlinks.js';
import { tiptapToBody } from './markdown.js';

function contentKey(value: unknown): string {
  return JSON.stringify(value, (key, v) => key === 'id' || v === null ? undefined
    : v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}

function viewKey(document: any): string {
  const entries = extractOverlay(document).map(({ newContent, originalBaseline, addedAtVersion: _version, ...entry }) => ({
    ...entry,
    proposed: newContent ? tiptapToBody({ type: 'doc', content: [newContent] }) : undefined,
    original: originalBaseline ? tiptapToBody({ type: 'doc', content: Array.isArray(originalBaseline) ? originalBaseline : [originalBaseline] }) : undefined,
  }));
  return contentKey({ body: tiptapToBody(document).trim(), entries });
}

export function saveViewedDocument(docId: string, document: unknown): void {
  if (docId !== getDocId()) throw new Error('The open document changed. Return to the outline and try again.');
  if (isAgentLocked(getActiveFilename())) throw new Error('The agent is still editing this outline. Wait for it to finish, then try again.');
  if (!document || (document as any).type !== 'doc' || viewKey(document) !== viewKey(getDocument())) {
    throw new Error('The outline changed while saving. Review its latest version, then try again.');
  }
  cancelDebouncedSave();
  save('human');
  // A refused serialization or write must not look like a successful flush.
  // Compare at each persistence boundary: canonical Markdown + overlay entries.
  // Rehydrated editor JSON legitimately has different default attrs/empty arrays.
  const disk = readFrontmatter(getActiveFilename());
  if (!disk || disk.content.trim() !== tiptapToBody(getCanonical()).trim()
    || contentKey(loadOverlay(docId)) !== contentKey(getOverlayEntries())) {
    throw new Error('The outline could not be saved completely. Your manuscript has not been built.');
  }
}
