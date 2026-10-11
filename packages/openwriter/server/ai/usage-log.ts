/**
 * Per-writer AI usage: one JSON line per chat turn or inline edit in
 * `<data root>/ai/usage.jsonl`. Tokens and tool calls only, never text or the
 * key. For spotting abuse and pricing an allowance later; nothing bills from it.
 * adr: adr/writer-key-ai.md
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { aiDir } from './key-store.js';

export interface UsageEntry {
  at: string;
  kind: 'chat' | 'inline-edit';
  model: string;
  /** Chat id for chat turns. */
  chatId?: string;
  docId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  /** What Anthropic's usage says the turn cost, when it says. */
  costUsd?: number;
  ok: boolean;
}

export function usageFile(): string {
  return join(aiDir(), 'usage.jsonl');
}

export function recordUsage(entry: Omit<UsageEntry, 'at'>): void {
  try {
    mkdirSync(aiDir(), { recursive: true });
    appendFileSync(usageFile(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // Usage is bookkeeping; a full disk must not fail the writer's edit.
  }
}

export function readUsage(limit = 500): UsageEntry[] {
  if (!existsSync(usageFile())) return [];
  const lines = readFileSync(usageFile(), 'utf-8').split('\n').filter(Boolean);
  return lines.slice(-limit).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** Map Anthropic's usage object (Messages API or the Agent SDK result) to our counts. */
export function tokenCounts(usage: any): Pick<UsageEntry, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'> {
  return {
    inputTokens: Number(usage?.input_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? 0),
    cacheReadTokens: Number(usage?.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(usage?.cache_creation_input_tokens ?? 0),
  };
}
