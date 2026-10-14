/**
 * Anchor matcher — given writing samples, returns a weighted training-data author blend.
 * Ported from openwriter-site/src/lib/writers-voice/{matcher-prompt,matcher}.ts.
 * Uses AVModelService for consistent caching, retries, env handling.
 */

import { AVModelService } from '../AVModelService.js';
import { extractFingerprint, type Fingerprint } from './featureExtractor.js';
import { getAuthorHintBlock } from './authorHints.js';

export interface AnchorBlendRow {
  author: string;
  weight: number;
  features_matched: string[];
}

export interface MatcherResult {
  blend: AnchorBlendRow[];
  self_check: {
    any_thematic_reasoning: boolean;
    confidence: 'high' | 'medium' | 'low';
    notes: string;
  };
}

export interface MatchOutput {
  blend: AnchorBlendRow[];
  fingerprint: Fingerprint;
  self_check: MatcherResult['self_check'];
  raw_response: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
}

export type MatcherContext = 'general' | 'tweets' | 'essays' | 'newsletter' | 'email';

function buildMatcherPrompt(
  samples: string[],
  fingerprint: Fingerprint,
  context: MatcherContext
): string {
  const fingerprintJson = JSON.stringify(fingerprint, null, 2);
  const samplesBlock = samples
    .map((s, i) => `<sample index="${i + 1}">\n${s.trim()}\n</sample>`)
    .join('\n\n');
  const authorHints = getAuthorHintBlock();

  return `<role>
You are a literary stylometry analyst. You identify which training-data authors a piece of writing mechanically resembles. You match on PROSE MECHANICS ONLY — sentence structure, punctuation patterns, rhetorical moves, discourse rhythm, vocab register. You NEVER match on content, themes, or subject matter.

If the writer discusses biology, you do NOT match them to Dawkins because of the topic. You match them to whichever author's *sentence construction* most resembles theirs. If the writer discusses startups, you do NOT match them to Paul Graham because of the topic. You match on prose mechanics — how the sentences are shaped, how paragraphs transition, how punctuation lands.
</role>

<hard_rules>
1. Score ONLY on prose mechanics. Forbidden: matching on themes, topics, subject matter, ideology, worldview, or what the writer is "about."
2. Output exactly 3-5 authors with weights summing to exactly 100.
3. Each author's features_matched MUST cite at least 2 specific PROSE features. Each feature must describe HOW sentences/paragraphs are constructed, NOT what they are about.
4. Prefer authors with heavy training-data representation — the model has the deepest compressed style modes for them.
5. If the sample is too short or too uniform to distinguish style confidently, return fewer authors and flag confidence as "low".
6. Author names from the hint list below are preferred. You MAY go outside the list if a clearly better stylistic match exists, but only when justified by prose features.
7. Output format must be strict JSON, no surrounding markdown or commentary.
</hard_rules>

<user_writing_context>
Mode: ${context}
</user_writing_context>

<user_samples>
${samplesBlock}
</user_samples>

<computed_features>
Deterministic statistical fingerprint of the user's writing. Cite these numbers when matching features (e.g., "55% short / 30% medium distribution matches Manson").

${fingerprintJson}
</computed_features>

<scoring_dimensions>
1. Sentence length distribution — short / medium / long / very-long percentages vs each candidate author's known distribution.
2. Punctuation profile — em-dash density, semicolon, colon, parenthetical, question, exclamation.
3. Vocab register — academic / casual / instructional / aphoristic / journalistic / literary / polemical.
4. Rhetorical moves — definitional pivots, anaphora, rule-of-three, dismissive concession, concept-coinage, claim-evidence order, direct address.
5. Discourse patterns — paragraph transitions. "But"/"So"/"However"/"Moreover". Question pivots. Time markers vs logical connectors.
6. Paragraph rhythm — uniform vs varied length. Where short paragraphs land.
7. Person & address — first / second / third person dominance.
8. Hedging vs assertion — qualifiers, certainty markers, softeners.
</scoring_dimensions>

<author_hint_list>
${authorHints}
</author_hint_list>

<output_schema>
Strict JSON in this shape, no markdown:
{
  "blend": [
    { "author": "<name>", "weight": <integer>, "features_matched": ["<prose feature 1>", "<prose feature 2>"] }
  ],
  "self_check": {
    "any_thematic_reasoning": <boolean>,
    "confidence": "high" | "medium" | "low",
    "notes": "<one short sentence>"
  }
}

Constraints:
- 3-5 entries in blend
- Weights are positive integers summing to exactly 100
- Each features_matched contains at least 2 entries describing prose construction (not themes)
- Valid features: "period-heavy short sentences (avg 9 words/sentence)", "concept-coinage with definitional pivots", "low em-dash density (0.3/1000)"
- INVALID: "writes about biology", "anti-establishment themes" — all content-based, forbidden.
</output_schema>

<self_criticism>
Before outputting, re-check each features_matched entry. If any describes content rather than mechanics, replace or remove that author.

If thematic reasoning leaked through and you couldn't fully fix it, set any_thematic_reasoning=true.

Confidence:
- "high" if samples >800 words and features clearly distinguishable
- "medium" if 400-800 words OR mixed/ambiguous features
- "low" if <400 words OR uniform samples
</self_criticism>

Now output the JSON. No preamble, no markdown fences, no commentary.`;
}

function parseMatcherJson(raw: string): MatcherResult {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`Matcher response is not JSON. Raw: ${raw.slice(0, 200)}`);
  }
  const jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonSlice) as MatcherResult;
  } catch (e) {
    throw new Error(`Matcher JSON parse failed: ${(e as Error).message}`);
  }
}

function validateBlend(result: MatcherResult): void {
  if (!Array.isArray(result.blend)) {
    throw new Error('Matcher result missing blend array');
  }
  if (result.blend.length < 1 || result.blend.length > 5) {
    throw new Error(`Matcher blend has ${result.blend.length} entries; expected 1-5`);
  }
  const sum = result.blend.reduce((acc, r) => acc + r.weight, 0);
  if (sum !== 100) {
    throw new Error(`Matcher blend weights sum to ${sum}, not 100`);
  }
  for (const row of result.blend) {
    if (!row.author || typeof row.author !== 'string') {
      throw new Error(`Matcher row missing author`);
    }
    if (!Array.isArray(row.features_matched) || row.features_matched.length < 2) {
      throw new Error(`Matcher row "${row.author}" needs at least 2 features_matched`);
    }
  }
  if (!result.self_check || typeof result.self_check.any_thematic_reasoning !== 'boolean') {
    throw new Error('Matcher result missing self_check');
  }
}

export async function matchVoice(
  samples: string[],
  context: MatcherContext = 'general'
): Promise<MatchOutput> {
  const fullText = samples.join('\n\n');
  const fingerprint = extractFingerprint(fullText);
  const prompt = buildMatcherPrompt(samples, fingerprint, context);

  const { content, usage } = await AVModelService.call(prompt, undefined, 'fast', 0.3, 2000);
  const parsed = parseMatcherJson(content);
  validateBlend(parsed);

  return {
    blend: parsed.blend,
    fingerprint,
    self_check: parsed.self_check,
    raw_response: content,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedCost: usage.estimatedCost },
  };
}
