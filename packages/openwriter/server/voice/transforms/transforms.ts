/**
 * TransformService — Document-level transforms for sidebar actions.
 * Ported from AV's DocumentTransformService with voice profiles and RAG removed.
 *
 * Actions: vary, shrinkify, expandify, threadify, storify, emailify, postify
 */

import { ModelService } from './model.js';
import { buildSystemPrompt, buildUserPrompt, type TransformAction } from './transform-prompts.js';
import type { ThreadResult } from './thread-types.js';
import { parseThreadResponse, threadToHtml } from './thread-parser.js';

export type { TransformAction } from './transform-prompts.js';

export const VALID_TRANSFORM_ACTIONS: TransformAction[] = [
  'vary', 'shrinkify', 'expandify', 'threadify', 'storify', 'emailify', 'postify',
];

export interface TransformParams {
  action: TransformAction;
  content: string;
  title: string;
  instructions?: string;
}

export interface TransformResult {
  success: true;
  html: string;
  newTitle: string;
  thread?: ThreadResult;
  rawResponse?: string;
  metadata: {
    action: TransformAction;
    processingTimeMs: number;
    estimatedCost: number;
  };
}

// ─── Action configs ──────────────────────────────────────────────────────────

interface ActionConfig {
  temperature: number;
  maxTokens: number;
  titleSuffix: string;
}

const ACTION_CONFIGS: Record<TransformAction, ActionConfig> = {
  vary:      { temperature: 0.4, maxTokens: 4096, titleSuffix: '(Variation)' },
  shrinkify: { temperature: 0.3, maxTokens: 4096, titleSuffix: '(Shrunk)' },
  expandify: { temperature: 0.7, maxTokens: 8192, titleSuffix: '(Expanded)' },
  threadify: { temperature: 0.3, maxTokens: 4096, titleSuffix: '(Thread)' },
  storify:   { temperature: 0.5, maxTokens: 4096, titleSuffix: '(Story)' },
  emailify:  { temperature: 0.3, maxTokens: 4096, titleSuffix: '(Email)' },
  postify:   { temperature: 0.4, maxTokens: 4096, titleSuffix: '(Posts)' },
};

// ─── Main Service ────────────────────────────────────────────────────────────

export class TransformService {
  static async transform(params: TransformParams): Promise<TransformResult> {
    const startTime = Date.now();
    const { action, content, title, instructions } = params;
    const config = ACTION_CONFIGS[action];

    // Build prompts (no voice profile, no RAG)
    const systemPrompt = buildSystemPrompt(action);
    const userPrompt = buildUserPrompt(action, content, title, instructions);

    // Call Claude
    const { content: rawResponse, usage } = await ModelService.call(
      userPrompt, systemPrompt, config.temperature, config.maxTokens,
    );

    const newTitle = `${title} ${config.titleSuffix}`;

    // For threadify: parse JSON array response into structured thread
    let html = rawResponse.trim();
    let thread: ThreadResult | undefined;
    if (action === 'threadify') {
      try {
        thread = parseThreadResponse(rawResponse);
        html = threadToHtml(thread);
        console.log(`[Transform] Threadify parsed: ${thread.totalTweets} tweets, allWithinLimit=${thread.allWithinLimit}`);
      } catch (err: any) {
        console.warn(`[Transform] Threadify JSON parse failed, using raw HTML fallback: ${err.message}`);
      }
    }

    return {
      success: true,
      html,
      newTitle,
      ...(thread ? { thread } : {}),
      ...(action === 'threadify' ? { rawResponse } : {}),
      metadata: {
        action,
        processingTimeMs: Date.now() - startTime,
        estimatedCost: usage.estimatedCost,
      },
    };
  }
}
