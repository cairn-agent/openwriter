/**
 * ModelService — Anthropic client for document transforms.
 * Copied from the publish server's transforms module (itself adapted from AV's
 * AVModelService); the call now runs on the writer's own key.
 *
 * Model: the newest Sonnet (../models.ts).
 */

import { claude } from '../host.js';
import { createMessage, modelFor, type LiveModel } from '../models.js';
import { recordUsage, tokenCounts } from '../usage-log.js';

export interface ModelResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    cacheCreation: number;
    cacheRead: number;
  };
}

// Anthropic's prices per million tokens for each line's newest model (5.5), so a newer id of the
// same line is still estimated, not priced as Opus.
const PRICING: Record<'opus' | 'sonnet' | 'haiku', { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  opus:   { input: 4.00, output: 20.00, cacheWrite: 5.00,  cacheRead: 0.40 },
  sonnet: { input: 2.00, output: 10.00, cacheWrite: 2.50,  cacheRead: 0.20 },
  haiku:  { input: 0.10, output: 0.50,  cacheWrite: 0.125, cacheRead: 0.01 },
};

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = [429, 503, 529];

function estimateCost(
  model: string, inputTokens: number, outputTokens: number,
  cacheCreationTokens = 0, cacheReadTokens = 0,
): number {
  const line = /^claude-(opus|sonnet|haiku)-/.exec(model)?.[1] as keyof typeof PRICING | undefined;
  const pricing = PRICING[line ?? 'opus'];
  return (
    inputTokens * pricing.input +
    outputTokens * pricing.output +
    cacheCreationTokens * pricing.cacheWrite +
    cacheReadTokens * pricing.cacheRead
  ) / 1_000_000;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ModelService {
  /**
   * Call the Anthropic API with exponential backoff retry for transient errors.
   */
  static async call(
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
  ): Promise<ModelResult> {
    const client = claude({ job: 'transform' });
    const live: LiveModel = await modelFor('sonnet');
    const model = live.id;

    let lastError: Error | null = null;

    // Always use cache control in Workers (production)
    const systemParam = systemPrompt
      ? { system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }] }
      : {};

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await createMessage(client, live, {
          max_tokens: maxTokens,
          temperature,
          ...systemParam,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.content
          .filter(block => block.type === 'text')
          .map(block => (block as { type: 'text'; text: string }).text)
          .join('');

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        const cacheCreation = (response.usage as any).cache_creation_input_tokens || 0;
        const cacheRead = (response.usage as any).cache_read_input_tokens || 0;
        const cost = estimateCost(model, inputTokens, outputTokens, cacheCreation, cacheRead);

        recordUsage({ kind: 'transform', model, ...tokenCounts(response.usage), toolCalls: 0, ok: response.stop_reason === 'end_turn' });

        return {
          content,
          usage: { inputTokens, outputTokens, estimatedCost: cost, cacheCreation, cacheRead },
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = err?.status || err?.statusCode;

        if (attempt === 1) recordUsage({ kind: 'transform', model, ...tokenCounts(null), toolCalls: 0, ok: false });
        if (RETRYABLE_STATUSES.includes(status) && attempt < MAX_RETRIES) {
          const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.warn(`[Transform] Retryable error ${status}, attempt ${attempt}/${MAX_RETRIES}, retrying in ${Math.round(delayMs)}ms`);
          await sleep(delayMs);
          continue;
        }

        console.error(`[Transform] Call failed: model=${model} attempt=${attempt} status=${status} error=${lastError.message}`);
        break;
      }
    }

    throw lastError || new Error('ModelService: unknown error');
  }
}
