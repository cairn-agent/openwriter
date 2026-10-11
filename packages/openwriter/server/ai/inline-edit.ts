/**
 * Inline edits: rewrite the selected text with one Messages API call on the
 * writer's own key, then hand the result to write_to_pad, so it arrives as an
 * ordinary pending change the writer accepts or rejects. No agent, no tools.
 * adr: adr/writer-key-ai.md
 */

import Anthropic from '@anthropic-ai/sdk';
import { TOOL_REGISTRY } from '../mcp.js';
import { loadKey, redactKey } from './key-store.js';
import { DEFAULT_REWRITE_MODEL, resolveModel } from './models.js';
import { recordUsage, tokenCounts } from './usage-log.js';
import {
  buildSystemPrompt, buildUserPrompt, computeSizeBudget, loadVoiceProfile,
  maxTokensFor, selectionWordCount, stripSelectionMarkersFromText,
} from './inline-edit-prompt.js';

export const MAX_SELECTION_WORDS = 5000;
const MAX_INSTRUCTION_CHARS = 2000;

export interface InlineEditRequest {
  docId: string;
  nodeIds: string[];
  /** TipTap JSON of the selected nodes; a partial selection carries [[START_SELECTION]] / [[END_SELECTION]]. */
  nodes: any[];
  contextBefore?: string[];
  contextAfter?: string[];
  instruction?: string;
  model?: string;
}

/** A failure the writer should read: `status` is the HTTP answer, `code` lets the UI react. */
export class InlineEditError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** The one Anthropic surface this module uses, so tests can stand in for it. */
export type MessagesClient = Pick<Anthropic, 'messages'>;
export type ClientFactory = (apiKey: string) => MessagesClient;

const defaultClientFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey, maxRetries: 1 });

function validate(req: InlineEditRequest): void {
  if (typeof req?.docId !== 'string' || !req.docId) throw new InlineEditError(400, 'bad_request', 'No document.');
  if (!Array.isArray(req.nodeIds) || req.nodeIds.length === 0 || !req.nodeIds.every((id) => typeof id === 'string' && id)) {
    throw new InlineEditError(400, 'bad_request', 'Select some text first.');
  }
  if (!Array.isArray(req.nodes) || req.nodes.length !== req.nodeIds.length) {
    throw new InlineEditError(400, 'bad_request', 'The selection did not match the document.');
  }
  if (req.instruction !== undefined && (typeof req.instruction !== 'string' || req.instruction.length > MAX_INSTRUCTION_CHARS)) {
    throw new InlineEditError(400, 'bad_request', `Keep the instruction under ${MAX_INSTRUCTION_CHARS} characters.`);
  }
}

/** Plain-language failure for each Anthropic error the writer can act on. */
function explainApiError(err: unknown): InlineEditError {
  if (err instanceof Anthropic.AuthenticationError) return new InlineEditError(401, 'key_rejected', 'Anthropic did not accept your API key. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new InlineEditError(403, 'key_forbidden', 'Your Anthropic key is not allowed to use this model.');
  if (err instanceof Anthropic.RateLimitError) return new InlineEditError(429, 'rate_limited', 'Anthropic is rate limiting your key. Try again in a minute.');
  if (err instanceof Anthropic.BadRequestError) {
    const msg = redactKey(String((err as Error).message || ''));
    if (/credit|billing|balance/i.test(msg)) return new InlineEditError(402, 'no_credit', 'Your Anthropic account is out of credit. Add credit in the Anthropic console.');
    return new InlineEditError(400, 'api_error', `Anthropic refused the request: ${msg}`);
  }
  if (err instanceof Anthropic.APIConnectionError) return new InlineEditError(502, 'unreachable', 'Could not reach Anthropic. Try again.');
  if (err instanceof Anthropic.APIError) return new InlineEditError(502, 'api_error', `Anthropic error ${err.status ?? ''}`.trim());
  return new InlineEditError(500, 'failed', 'The rewrite failed.');
}

export async function runInlineEdit(
  req: InlineEditRequest,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ applied: number; model: string }> {
  validate(req);
  const key = loadKey();
  if (!key) throw new InlineEditError(409, 'no_key', 'Add your Anthropic API key in Settings to use AI.');

  const words = selectionWordCount(req.nodes);
  if (words > MAX_SELECTION_WORDS) {
    throw new InlineEditError(413, 'too_large', `Selection too large: ${words.toLocaleString()} words (max ${MAX_SELECTION_WORDS.toLocaleString()}). Select a smaller section.`);
  }

  const model = resolveModel(req.model, DEFAULT_REWRITE_MODEL);
  const instruction = req.instruction?.trim() || undefined;
  const action = instruction ? 'custom' : 'rewrite';
  const budget = computeSizeBudget(action, req.nodes);
  const system = buildSystemPrompt(loadVoiceProfile());
  const user = buildUserPrompt({ nodes: req.nodes, action, instruction, contextBefore: req.contextBefore, contextAfter: req.contextAfter, budget });

  let response: Anthropic.Message;
  try {
    response = await clientFactory(key).messages.create({
      model: model.id,
      // Opus 5.5 and Sonnet 5.5 think by default and spend from the same ceiling.
      max_tokens: maxTokensFor(budget, !!model.rewriteEffort),
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      ...(model.rewriteEffort ? { output_config: { effort: model.rewriteEffort } } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (err) {
    recordUsage({ kind: 'inline-edit', model: model.id, docId: req.docId, ...tokenCounts(null), toolCalls: 0, ok: false });
    throw explainApiError(err);
  }

  recordUsage({ kind: 'inline-edit', model: model.id, docId: req.docId, ...tokenCounts(response.usage), toolCalls: 0, ok: response.stop_reason === 'end_turn' });

  if (response.stop_reason === 'refusal') throw new InlineEditError(422, 'refused', 'Claude declined to rewrite this passage.');
  if (response.stop_reason === 'max_tokens') throw new InlineEditError(422, 'too_long', 'The rewrite ran past its length limit. Try a smaller selection.');

  const markdown = stripSelectionMarkersFromText(
    response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n'),
  ).trim();
  if (!markdown) throw new InlineEditError(422, 'empty', 'Claude returned no text.');

  // The rewrite replaces the first selected node; the rest of the selection is folded into it.
  const [first, ...rest] = req.nodeIds;
  const changes = [
    { operation: 'rewrite', nodeId: first, content: markdown },
    ...rest.map((nodeId) => ({ operation: 'delete', nodeId })),
  ];
  const writeToPad = TOOL_REGISTRY.find((t) => t.name === 'write_to_pad');
  if (!writeToPad) throw new InlineEditError(500, 'failed', 'The editor is not ready.');
  const result = await writeToPad.handler({ docId: req.docId, changes });
  let applied = 0;
  try { applied = Number(JSON.parse(result.content[0].text).appliedCount ?? 0); } catch { /* reported below */ }
  if (applied === 0) throw new InlineEditError(409, 'stale', 'The text changed while rewriting. Select it again.');
  return { applied, model: model.choice };
}
