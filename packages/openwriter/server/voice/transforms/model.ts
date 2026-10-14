/**
 * ModelService — Anthropic client for document transforms.
 * Copied from the publish server's transforms module (itself adapted from AV's
 * AVModelService); the call now runs on the writer's own key.
 *
 * Model: the newest Sonnet (../models.ts); AV_FAST_MODEL / AV_PREMIUM_MODEL still pin one by id.
 */

import { claude } from '../host.js';
import { createMessage, modelFor, type LiveModel } from '../models.js';
import { recordUsage, tokenCounts } from '../usage-log.js';

export type ProviderMode = 'fast' | 'premium';

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

export interface ModelEnv {
  AV_FAST_MODEL?: string;
  AV_PREMIUM_MODEL?: string;
}

// Published Anthropic pricing (per million tokens)
const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-haiku-4-5-20251001':   { input: 0.80,  output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 },
  'claude-sonnet-4-5-20250929':  { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-4-6':           { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-opus-4-6':             { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
};
const DEFAULT_PRICING = { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 };

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = [429, 503, 529];

async function resolveModel(env: ModelEnv, mode: ProviderMode): Promise<LiveModel> {
  const latest = await modelFor('sonnet');
  const pinned = mode === 'fast' ? env.AV_FAST_MODEL : env.AV_PREMIUM_MODEL;
  return pinned ? { ...latest, id: pinned, name: pinned } : latest;
}

function estimateCost(
  model: string, inputTokens: number, outputTokens: number,
  cacheCreationTokens = 0, cacheReadTokens = 0,
): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
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
    env: ModelEnv,
    prompt: string,
    systemPrompt?: string,
    mode: ProviderMode = 'fast',
    temperature: number = 0.7,
    maxTokens: number = 4096,
  ): Promise<ModelResult> {
    const client = claude({ job: 'transform' });
    const live = await resolveModel(env, mode);
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
