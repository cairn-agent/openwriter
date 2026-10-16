/** Agent-boundary guidance. Internal tool callers do not consume delivery.
 * adr: adr/in-system-guidance.md */
import { resolveDocId, getActiveFilename } from './documents.js';
import { getMetadata, getCachedDocument } from './state.js';
import { resolveDocPath } from './helpers.js';
import { readFrontmatter } from './backlinks.js';
import { deriveContentType } from './content-type-meta.js';
import { guidanceFor } from './doc-guidance.js';
import type { ToolResult } from './mcp.js';

/** A document named by the call, or announced by create/open. */
export function appendDocGuidance(session: string, args: unknown, result: ToolResult): ToolResult {
  const first = result?.content?.[0]?.text ?? '';
  if (/^Error/.test(first)) return result;
  const named = (args as { docId?: unknown } | null)?.docId;
  const docId = typeof named === 'string' ? named : /^(?:Created|Opened) .*? \[([0-9a-f]{8})\]/.exec(first)?.[1];
  if (!docId) return result;
  let metadata: Record<string, any> | undefined;
  try {
    const filename = resolveDocId(docId);
    metadata = filename === getActiveFilename()
      ? getMetadata()
      : getCachedDocument(resolveDocPath(filename))?.metadata ?? readFrontmatter(filename)?.data;
  } catch { return result; }
  const guidance = metadata ? guidanceFor(session, docId, deriveContentType(metadata)) : null;
  return guidance ? { ...result, content: [...result.content, { type: 'text', text: guidance }] } : result;
}
