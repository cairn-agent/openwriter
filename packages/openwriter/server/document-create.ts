/**
 * Create a document the way POST /api/documents does: the file, its metadata,
 * the plugin flags (pending, agent-created) and the broadcasts. One function so
 * plugins can create documents in-process instead of calling that route.
 */

import { createDocument } from './documents.js';
import { save, getDocument, setMetadata, markAllNodesAsPending, updatePendingCacheForActiveDoc, markAsAgentStub } from './state.js';
import { broadcastDocumentSwitched, broadcastDocumentsChanged, broadcastPendingDocsChanged } from './ws.js';

export interface CreateDocumentRequest {
  title?: string;
  content?: any;
  path?: string;
  metadata?: Record<string, any>;
  masterDocId?: string;
  variantType?: string;
  markPending?: boolean;
  agentCreated?: boolean;
}

/** `tab`: the browser tab that asked, so only it navigates. adr: adr/per-tab-view.md */
export function createDocumentFromRequest(body: CreateDocumentRequest, tab?: string) {
  const result = createDocument(body.title as string, body.content, body.path);

  // Apply metadata if provided (e.g. tweetContext for threadified docs)
  if (body.metadata) {
    setMetadata(body.metadata);
    save();
  }

  // Variant relationship — set masterDocId and variantType in frontmatter
  if (body.masterDocId || body.variantType) {
    const variantMeta: Record<string, any> = {};
    if (body.masterDocId) variantMeta.masterDocId = body.masterDocId;
    if (body.variantType) variantMeta.variantType = body.variantType;
    setMetadata(variantMeta);
    save();
  }

  // Plugin flags: mark all content as pending + tag as agent-created
  if (body.markPending) {
    markAllNodesAsPending(getDocument(), 'insert');
    updatePendingCacheForActiveDoc();
    save();
  }
  if (body.agentCreated) {
    // In-memory stub registry — not persisted to disk frontmatter.
    // adr: adr/agent-stub-model.md
    markAsAgentStub(result.filename);
  }

  // A sidebar request names its tab; only that tab navigates. adr: adr/per-tab-view.md
  broadcastDocumentSwitched(result.document, result.title, result.filename, undefined, body.agentCreated ? 'open' : 'create', { tab });
  broadcastDocumentsChanged();
  if (body.markPending || body.agentCreated) {
    broadcastPendingDocsChanged();
  }
  return result;
}
