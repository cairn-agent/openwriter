/**
 * @file AuthorVoiceAnalysis.ts
 * @description Voice profile analysis — negative-first architecture.
 *
 *   The profile is now pure avoidance plus exact-presentation fingerprints.
 *   The positive side of the voice lives entirely in retrieved corpus
 *   chunks at apply time (RAG). See docs/voice-profile-strategy.md.
 *
 *   Pipeline:
 *     corpus
 *       │
 *       ├─► NegativeExtractor (deterministic)
 *       │     - AI-tells tally (fails authenticity hurdle → NEVER rule)
 *       │     - Punctuation tally (never → No X.)
 *       │     - Fingerprint detectors (em-dash spacing, oxford comma, …)
 *       │     - Sentence distribution
 *       │
 *       ├─► LLM (binary structural votes + user_friendly_summary only)
 *       │     The LLM never writes rule text. Code does.
 *       │
 *       └─► Assembled AuthorVoiceGuidelines
 */

import logger from '../logger.js';
import {
  extractDeterministic,
  applyStructuralVotes,
  renderTallyTable,
  renderStructuralVotePrompt,
  type PunctuationTally,
  type DeterministicExtraction,
} from './NegativeExtractor.js';
import { STRUCTURAL_KEYS } from './AITellsCatalog.js';

// Re-export for back-compat: previously lived here, consumers may import it.
export {
  computePunctuationFrequencies,
  type PunctuationTally,
} from './NegativeExtractor.js';

// ─── Profile Schema (new, negative-first) ───────────────────────────────────

export interface AuthorVoiceGuidelines {
  author_voice_guidelines: {
    /**
     * Avoidance rules bucketed by linguistic category. All rules are
     * code-authored. `NEVER X.` for AI-tell overlaps, `No X.` otherwise.
     */
    avoid: {
      diction: string[];
      syntax: string[];
      punctuation: string[];
    };

    /**
     * One-line rendered fingerprints — exact-presentation choices the
     * author makes consistently (em-dash spacing, quote style, etc.).
     * RAG cannot reliably convey these from retrieved chunks.
     */
    fingerprints: string[];

    /**
     * One-line rendered signature rules — positive voice tics the author
     * reaches for habitually (intensifiers, hedges, emphatics, discourse
     * openers, structural habits). Inverse of `avoid`: tells the LLM what
     * the author DOES do unusually often so it mimics the rate.
     */
    signature: string[];

    /** Sentence length distribution for dynamic gate. */
    sentence_distribution: {
      average_length: number;
      short_pct: number;
      medium_pct: number;
      long_pct: number;
      very_long_pct: number;
      short_max_words: number;
      long_min_words: number;
    };

    confidence: 'Low' | 'Medium' | 'High';

    /** Frontend display only — not fed to AI. */
    user_friendly_summary?: {
      summary: string;
      writing_style: string;
      voice_signature: string;
      confidence_description: string;
    };
  };
}

// ─── LLM Response Shape (what the model is asked for) ───────────────────────

/**
 * The LLM's ONLY outputs are:
 *   1. Binary yes/no votes on the 5 structural AI patterns (code writes the rule).
 *   2. A user-friendly summary for the frontend (not fed back into prompts).
 *   3. A confidence label (Low/Medium/High).
 */
interface LLMAnalysisResponse {
  structural_votes: Record<string, boolean>;
  confidence: 'Low' | 'Medium' | 'High';
  user_friendly_summary: {
    summary: string;
    writing_style: string;
    voice_signature: string;
    confidence_description: string;
  };
}

// ─── Prompt Generation ──────────────────────────────────────────────────────

/**
 * Build the minimal analysis prompt. The LLM is asked only for binary
 * structural votes + a user-friendly summary. All rule text is produced
 * deterministically by the NegativeExtractor.
 */
export function generateAnalysisPrompt(content: string): string {
  const extraction = extractDeterministic(content);
  return renderAnalysisPrompt(content, extraction);
}

function renderAnalysisPrompt(content: string, extraction: DeterministicExtraction): string {
  const tallyTable = renderTallyTable(extraction.punctuation_tally);
  const structuralList = renderStructuralVotePrompt();
  const fingerprintPreview = extraction.fingerprints.length > 0
    ? extraction.fingerprints.map(f => `  - ${f}`).join('\n')
    : '  (none detected — insufficient corpus evidence)';

  const aiForbid = extraction.ai_tell_tally.forbid_labels.length;
  const aiPreserve = extraction.ai_tell_tally.preserve_labels.length;
  const aiBelow = extraction.ai_tell_tally.below_hurdle_labels.length;

  return `You are a linguistic analyst. Your ONLY job is to answer a short list of yes/no questions about structural patterns in the writing below, plus produce a short user-friendly summary. You do NOT write style rules. You do NOT invent patterns. Rules are generated deterministically from the tally below; your votes only decide which structural rules apply.

─── DETERMINISTIC TALLY (for your reference — already applied by code) ───

Word count: ${extraction.punctuation_tally.words}

Punctuation frequencies (per 1k words):
${tallyTable}

AI-tell catalog: ${aiForbid} forbidden, ${aiPreserve} preserved (${aiBelow} present but below authenticity hurdle → forbidden).
(Items that clear the per-category volume/rate hurdle are preserved as the author's own voice; everything else — absent, or present only in trace amounts likely from AI-contaminated samples — becomes a NEVER rule.)

Formatting fingerprints already detected:
${fingerprintPreview}

─── YOUR TASK ───

For each of the 5 structural patterns below, answer TRUE if this author uses it
(so it should be preserved, no rule emitted), or FALSE if this author does NOT
use it (so code will emit a NEVER rule for it).

Structural patterns to vote on:
${structuralList}

Also produce:
  - confidence (Low / Medium / High) — based on corpus size and signal clarity
  - user_friendly_summary — warm, specific, never quotes the corpus verbatim

─── FORMAT YOUR RESPONSE AS JSON ───

{
  "structural_votes": {
${STRUCTURAL_KEYS.map(k => `    "${k}": true|false`).join(',\n')}
  },
  "confidence": "Low|Medium|High",
  "user_friendly_summary": {
    "summary": "2-3 sentence warm summary of this author's voice.",
    "writing_style": "1-2 sentence style description.",
    "voice_signature": "Technical metrics with specific numbers.",
    "confidence_description": "Encouraging explanation of analysis quality."
  }
}

HARD CONSTRAINTS:
1. Return ONLY valid JSON. No prose, no markdown fencing outside the JSON, no comments.
2. Every key in structural_votes must be present and must be a boolean.
3. Do NOT output any rules, avoidances, or style descriptions outside user_friendly_summary.
4. The user_friendly_summary must not quote the corpus verbatim.

─── CONTENT TO ANALYZE ───
${content}
`;
}

// ─── Analysis Orchestrator ──────────────────────────────────────────────────

/**
 * Full pipeline: deterministic extraction → LLM binary votes + summary →
 * assembled AuthorVoiceGuidelines.
 *
 * The caller supplies a `callLLM` function so this module stays provider-
 * agnostic. AuthorVoiceService wires in AVModelService.
 */
export async function analyze(
  content: string,
  callLLM: (prompt: string) => Promise<string>
): Promise<AuthorVoiceGuidelines> {
  const extraction = extractDeterministic(content);
  const prompt = renderAnalysisPrompt(content, extraction);

  const rawResponse = await callLLM(prompt);
  const llm = validateAndParseLLMResponse(rawResponse);

  return assembleGuidelines(extraction, llm);
}

/**
 * Merge deterministic extraction with LLM votes/summary into the final
 * profile. Code authors every rule string — the LLM never does.
 */
export function assembleGuidelines(
  extraction: DeterministicExtraction,
  llm: LLMAnalysisResponse
): AuthorVoiceGuidelines {
  const avoid = {
    diction: [...extraction.avoid_partial.diction],
    syntax: [...extraction.avoid_partial.syntax],
    punctuation: [...extraction.avoid_partial.punctuation],
  };
  applyStructuralVotes(avoid, llm.structural_votes || {});

  return {
    author_voice_guidelines: {
      avoid,
      fingerprints: extraction.fingerprints,
      signature: extraction.signature,
      sentence_distribution: extraction.sentence_distribution,
      confidence: llm.confidence,
      user_friendly_summary: llm.user_friendly_summary,
    },
  };
}

// ─── Response Parsing ────────────────────────────────────────────────────────

/**
 * Parse the minimal LLM response. Validates shape (votes + confidence +
 * summary) but does NOT attempt to salvage malformed rule arrays — because
 * the LLM no longer emits rules.
 */
export function validateAndParseLLMResponse(aiResponse: string): LLMAnalysisResponse {
  try {
    let jsonStr = aiResponse;
    logger.info('Raw AI response length: ' + aiResponse.length);

    if (aiResponse.includes('```json')) {
      jsonStr = aiResponse.split('```json')[1].split('```')[0].trim();
    } else if (aiResponse.includes('```')) {
      jsonStr = aiResponse.split('```')[1].split('```')[0].trim();
    }

    jsonStr = sanitizeJson(jsonStr);

    const parsed = JSON.parse(jsonStr) as Record<string, any>;

    if (!isValidLLMResponse(parsed)) {
      throw new Error('Invalid LLM response structure — missing structural_votes, confidence, or user_friendly_summary');
    }

    return parsed as LLMAnalysisResponse;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error parsing AI response: ${errorMessage}`);
    throw new Error('Failed to parse AI response to valid JSON');
  }
}

/**
 * Back-compat wrapper. Some callers still expect a full AuthorVoiceGuidelines
 * from a raw LLM response — but the new LLM contract does not include rules.
 * This path assembles a profile by running the extractor on a caller-supplied
 * corpus. Prefer {@link analyze} for the full pipeline.
 */
export function validateAndParseResponse(
  aiResponse: string,
  corpus?: string
): AuthorVoiceGuidelines {
  const llm = validateAndParseLLMResponse(aiResponse);
  if (!corpus) {
    throw new Error('validateAndParseResponse requires corpus for deterministic assembly — use analyze() instead');
  }
  const extraction = extractDeterministic(corpus);
  return assembleGuidelines(extraction, llm);
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function isValidLLMResponse(json: Record<string, any>): json is LLMAnalysisResponse {
  try {
    if (!json || typeof json !== 'object') return false;

    const votes = json.structural_votes;
    if (!votes || typeof votes !== 'object') return false;
    for (const key of STRUCTURAL_KEYS) {
      if (typeof votes[key] !== 'boolean') return false;
    }

    if (!['Low', 'Medium', 'High'].includes(json.confidence)) return false;

    const ufs = json.user_friendly_summary;
    if (!ufs || typeof ufs !== 'object') return false;
    if (typeof ufs.summary !== 'string') return false;
    if (typeof ufs.writing_style !== 'string') return false;
    if (typeof ufs.voice_signature !== 'string') return false;
    if (typeof ufs.confidence_description !== 'string') return false;

    return true;
  } catch {
    return false;
  }
}

export function isValidAuthorVoiceGuidelines(json: Record<string, any>): json is AuthorVoiceGuidelines {
  try {
    if (!json || typeof json !== 'object') return false;
    const g = json.author_voice_guidelines;
    if (!g || typeof g !== 'object') return false;

    // New schema: avoid block
    const av = g.avoid;
    if (!av || typeof av !== 'object') return false;
    for (const cat of ['diction', 'syntax', 'punctuation']) {
      if (!Array.isArray(av[cat])) return false;
      if (!av[cat].every((r: unknown) => typeof r === 'string')) return false;
    }

    // Fingerprints
    if (!Array.isArray(g.fingerprints)) return false;
    if (!g.fingerprints.every((r: unknown) => typeof r === 'string')) return false;

    // Confidence
    if (!['Low', 'Medium', 'High'].includes(g.confidence)) return false;

    // Sentence distribution
    const sd = g.sentence_distribution;
    if (!sd || typeof sd !== 'object') return false;
    const numericKeys = [
      'average_length', 'short_pct', 'medium_pct', 'long_pct',
      'very_long_pct', 'short_max_words', 'long_min_words',
    ];
    for (const k of numericKeys) {
      if (typeof sd[k] !== 'number') return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ─── JSON Sanitization ──────────────────────────────────────────────────────

export function sanitizeJson(jsonStr: string): string {
  const original = jsonStr;

  try {
    jsonStr = jsonStr.replace(/,\s*]/g, ']');
    jsonStr = jsonStr.replace(/,\s*}/g, '}');
    jsonStr = jsonStr.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    for (let i = 0; i <= 31; i++) {
      jsonStr = jsonStr.split(String.fromCharCode(i)).join(' ');
    }

    jsonStr = jsonStr.replace(
      /:\s*"((?:[^"\\]|\\.)*)"/g,
      (_match, inner) => `: "${inner}"`
    );

    let testStr = jsonStr;
    for (let attempts = 0; attempts < 10; attempts++) {
      try {
        JSON.parse(testStr);
        jsonStr = testStr;
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('Unterminated string')) {
          testStr = testStr + '"';
        } else if (msg.includes('Expected') || msg.includes('Unexpected')) {
          const opens = (testStr.match(/[{[]/g) || []).length;
          const closes = (testStr.match(/[}\]]/g) || []).length;
          if (opens > closes) {
            testStr = testStr.replace(/,\s*$/, '');
            const needed = opens - closes;
            const stack: string[] = [];
            for (const ch of testStr) {
              if (ch === '{') stack.push('}');
              else if (ch === '[') stack.push(']');
              else if (ch === '}' || ch === ']') stack.pop();
            }
            testStr += stack.reverse().slice(0, needed).join('');
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    if (jsonStr !== original) {
      logger.info('JSON sanitization applied fixes');
    }
    return jsonStr;
  } catch {
    return original;
  }
}
