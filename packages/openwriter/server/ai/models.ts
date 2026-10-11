/**
 * The Claude models a writer can pick, in one place. Inline edits and the chat
 * both resolve the writer's choice here. adr: adr/writer-key-ai.md
 */

export type ModelChoice = 'opus' | 'sonnet' | 'haiku';

export interface ModelInfo {
  id: string;
  label: string;
  /** `output_config.effort` for a quick rewrite. Haiku 4.5 rejects the field. */
  rewriteEffort?: 'low' | 'medium';
}

export const MODELS: Record<ModelChoice, ModelInfo> = {
  opus: { id: 'claude-opus-5-5', label: 'Opus', rewriteEffort: 'low' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Sonnet', rewriteEffort: 'low' },
  haiku: { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
};

export const DEFAULT_REWRITE_MODEL: ModelChoice = 'opus';
export const DEFAULT_CHAT_MODEL: ModelChoice = 'sonnet';

export function resolveModel(choice: unknown, fallback: ModelChoice): ModelInfo & { choice: ModelChoice } {
  const key = (typeof choice === 'string' && choice in MODELS ? choice : fallback) as ModelChoice;
  return { ...MODELS[key], choice: key };
}
