/**
 * AVModelService — the model caller Author's Voice's profile code expects, on the writer's key.
 * Same contract as authors-voice packages/api/src/services/AVModelService.ts for the Claude
 * models it used here: 'fast' is the newest Haiku (the blend matcher), 'premium' the newest
 * Sonnet (the voice analysis), with its retries on 429/503/529. Models: ../models.ts.
 */

import { claude } from '../host.js';
import { createMessage, modelFor } from '../models.js';
import { recordUsage, tokenCounts } from '../usage-log.js';

export type AVProviderMode = 'fast' | 'premium';

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
  ): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number; estimatedCost: number; cacheCreation: number; cacheRead: number } }> {
    const live = await modelFor(mode === 'fast' ? 'haiku' : 'sonnet');
    const model = live.id;
    const client = claude({ job: 'learn' });
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await createMessage(client, live, {
          max_tokens: maxTokens,
          temperature,
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
