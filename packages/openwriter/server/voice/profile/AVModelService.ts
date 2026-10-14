/**
 * AVModelService — the model caller Author's Voice's profile code expects, on the writer's key.
 * Same contract as authors-voice packages/api/src/services/AVModelService.ts for the Claude
 * models it used here: 'fast' is Haiku 4.5 (the blend matcher), 'premium' is Sonnet 4.6 (the
 * voice analysis), with its retries on 429/503/529.
 */

import { claude } from '../host.js';
import { recordUsage, tokenCounts } from '../usage-log.js';

export type AVProviderMode = 'fast' | 'premium';

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const PREMIUM_MODEL = 'claude-sonnet-4-6';
const TEMPERATURE_DEPRECATED = new Set(['claude-opus-4-8', 'claude-opus-5-5']);

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = [429, 503, 529];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AVModelService {
  static async call(
    prompt: string,
    systemPrompt?: string,
    mode: AVProviderMode = 'premium',
    temperature: number = 0.7,
    maxTokens: number = 4096,
    modelOverride?: string,
  ): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number; estimatedCost: number; cacheCreation: number; cacheRead: number } }> {
    const model = modelOverride || (mode === 'fast' ? FAST_MODEL : PREMIUM_MODEL);
    const client = claude();
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          ...(TEMPERATURE_DEPRECATED.has(model) ? {} : { temperature }),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: 'user', content: prompt }],
        });
        const content = response.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { type: 'text'; text: string }).text)
          .join('');
        recordUsage({ kind: 'voice-profile', model, ...tokenCounts(response.usage), toolCalls: 0, ok: response.stop_reason === 'end_turn' });
        return {
          content,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            estimatedCost: 0,
            cacheCreation: (response.usage as any).cache_creation_input_tokens || 0,
            cacheRead: (response.usage as any).cache_read_input_tokens || 0,
          },
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = err?.status || err?.statusCode;
        if (RETRYABLE_STATUSES.includes(status) && attempt < MAX_RETRIES) {
          await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 500);
          continue;
        }
        recordUsage({ kind: 'voice-profile', model, ...tokenCounts(null), toolCalls: 0, ok: false });
        break;
      }
    }
    throw lastError || new Error('AVModelService: unknown error');
  }
}
