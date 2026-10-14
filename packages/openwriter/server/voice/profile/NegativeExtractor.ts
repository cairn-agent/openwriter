/**
 * @file NegativeExtractor.ts
 * @description Deterministic extraction of the voice profile's negative
 *   constraints and fingerprint block from a corpus.
 *
 *   Pipeline:
 *     corpus string
 *       │
 *       ├─ AI-tells catalog scan  ─────────► avoid.diction[] + avoid.punctuation[]
 *       │  (fails authenticity hurdle ⇒ NEVER rule;
 *       │   clears hurdle ⇒ skip, preserve voice —
 *       │   see AUTHENTICITY_THRESHOLDS)
 *       │
 *       ├─ Punctuation tally ───────────────► avoid.punctuation[]
 *       │  (rate 0 + not in AI-tells ⇒ "No X.")
 *       │
 *       ├─ Fingerprint detector ────────────► fingerprints[]
 *       │
 *       └─ Sentence distribution ───────────► sentence_distribution
 *
 *   The LLM never writes rule text. Its only job in analysis is binary
 *   votes on the 5 structural patterns in AI_STRUCTURAL_PATTERNS, plus
 *   the user-friendly summary. See AuthorVoiceAnalysis.ts.
 */

import {
  AI_TELLS,
  AI_TELL_LABELS,
  AI_STRUCTURAL_PATTERNS,
  AIStructuralPattern,
  AITell,
  AITellCategory,
} from './AITellsCatalog.js';
import {
  FingerprintSet,
  detectFingerprints,
  renderFingerprints,
} from './FingerprintDetector.js';
import {
  SignatureSet,
  detectSignatures,
  renderSignature,
} from './SignatureDetector.js';

// ─── Punctuation Tally (kept from prior implementation) ─────────────────────

export interface PunctuationTally {
  words: number;
  per1k: Record<string, number>;
  raw: Record<string, number>;
  category: Record<string, 'never' | 'rare' | 'low' | 'strong'>;
}

export function computePunctuationFrequencies(content: string): PunctuationTally {
  const words = content.split(/\s+/).filter(Boolean).length || 1;
  const count = (re: RegExp) => (content.match(re) || []).length;

  const raw = {
    em_dash: count(/\u2014/g),
    en_dash: count(/\u2013/g),
    colon: count(/:/g),
    semicolon: count(/;/g),
    question: count(/\?/g),
    exclamation: count(/!/g),
    ellipsis: count(/\.{3}|\u2026/g),
    paren_pair: Math.min(count(/\(/g), count(/\)/g)),
    bracket: count(/\[/g),
    double_quote_straight: count(/"/g),
    double_quote_curly: count(/[\u201C\u201D]/g),
    single_quote_curly: count(/[\u2018\u2019]/g),
    contractions: count(/\b\w+['\u2019](?:s|re|ve|ll|d|t|m)\b/gi),
    sent_init_but: count(/(?:^|[.!?]\s+)But\b/g),
    sent_init_and: count(/(?:^|[.!?]\s+)And\b/g),
    sent_init_so: count(/(?:^|[.!?]\s+)So\b/g),
    sent_init_this: count(/(?:^|[.!?]\s+)This\b/g),
  };

  const per1k: Record<string, number> = {};
  const category: Record<string, 'never' | 'rare' | 'low' | 'strong'> = {};
  for (const [k, v] of Object.entries(raw)) {
    const rate = (v / words) * 1000;
    per1k[k] = Math.round(rate * 100) / 100;
    category[k] = rate === 0 ? 'never' : rate < 0.5 ? 'rare' : rate < 2 ? 'low' : 'strong';
  }

  return { words, per1k, raw, category };
}

// ─── AI-Tells Tally ─────────────────────────────────────────────────────────

/**
 * Authenticity hurdles. A catalog item is considered "part of the author's
 * voice" (and therefore preserved, no NEVER rule) only if both thresholds
 * are cleared. Otherwise the item is treated as corpus contamination (e.g.
 * an AI-written sample smuggled into the training set) and a NEVER rule
 * is emitted.
 *
 * Thresholds are per-category because baseline rates differ: single words
 * recur naturally, multi-word phrases almost never do unless they're a
 * habit, and punctuation marks need a visible drumbeat before we can call
 * them signature.
 *
 * Tuned conservatively — prefer false-negatives (preserve genuine usage)
 * over false-positives (suppress the author's own words). Adjust if live
 * rewrites show known tells leaking through.
 */
export const AUTHENTICITY_THRESHOLDS: Record<AITellCategory, { min_count: number; min_rate_per_1k: number }> = {
  word:        { min_count: 2,  min_rate_per_1k: 0.15 },
  transition:  { min_count: 2,  min_rate_per_1k: 0.15 },
  phrase:      { min_count: 2,  min_rate_per_1k: 0.05 },
  // Punctuation — and em-dashes in particular — is the single biggest AI
  // tell and the hardest to dislodge. A few contaminating AI paragraphs
  // drop em-dashes at ~2–5/1k, which easily clears a modest hurdle. So the
  // bar is set high enough that only a clearly habitual user clears it:
  // 15+ instances AND ≥1.5/1k. For a 20k-word corpus that's 30+ em-dashes
  // at a sustained rate — unambiguously signature.
  punctuation: { min_count: 15, min_rate_per_1k: 1.5 },
};

/**
 * Does the author use this catalog item enough to call it theirs?
 * Returns true → preserve voice, emit no rule.
 * Returns false → treat as AI-tell contamination, emit NEVER rule.
 */
export function passesAuthenticityHurdle(tell: AITell, count: number, words: number): boolean {
  if (count <= 0) return false;
  const t = AUTHENTICITY_THRESHOLDS[tell.category];
  const rate = (count / Math.max(1, words)) * 1000;
  return count >= t.min_count && rate >= t.min_rate_per_1k;
}

export interface AITellTally {
  /** label → raw count in corpus */
  counts: Record<string, number>;
  /** label → rate per 1k words */
  rate_per_1k: Record<string, number>;
  /** labels that fail the authenticity hurdle → emit NEVER rule */
  forbid_labels: string[];
  /** labels that clear the authenticity hurdle → preserve, no rule */
  preserve_labels: string[];
  /** labels present in corpus but below hurdle (ambiguous — likely contamination) */
  below_hurdle_labels: string[];
}

export function computeAITellTally(corpus: string, words?: number): AITellTally {
  const totalWords = words ?? (corpus.split(/\s+/).filter(Boolean).length || 1);
  const counts: Record<string, number> = {};
  const rate_per_1k: Record<string, number> = {};
  const forbid: string[] = [];
  const preserve: string[] = [];
  const below: string[] = [];

  for (const tell of AI_TELLS) {
    // RegExp exec state is sticky with /g; reset to be safe.
    tell.pattern.lastIndex = 0;
    const n = (corpus.match(tell.pattern) || []).length;
    counts[tell.label] = n;
    rate_per_1k[tell.label] = Math.round((n / totalWords) * 1000 * 100) / 100;

    if (passesAuthenticityHurdle(tell, n, totalWords)) {
      preserve.push(tell.label);
    } else {
      forbid.push(tell.label);
      if (n > 0) below.push(tell.label);
    }
  }

  return {
    counts,
    rate_per_1k,
    forbid_labels: forbid,
    preserve_labels: preserve,
    below_hurdle_labels: below,
  };
}

// ─── Sentence Distribution ──────────────────────────────────────────────────

export interface SentenceDistribution {
  average_length: number;
  short_pct: number;
  medium_pct: number;
  long_pct: number;
  very_long_pct: number;
  short_max_words: number;
  long_min_words: number;
}

export function computeSentenceDistribution(corpus: string): SentenceDistribution {
  const sentences = corpus.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) {
    return {
      average_length: 0, short_pct: 0, medium_pct: 0, long_pct: 0,
      very_long_pct: 0, short_max_words: 10, long_min_words: 23,
    };
  }
  const wordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const avg = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;

  // Boundaries derived from the author's distribution (25th / 75th percentile).
  const sorted = [...wordCounts].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const short_max = Math.max(6, Math.min(12, q(0.25)));
  const long_min = Math.max(18, Math.min(28, q(0.75)));

  const short = wordCounts.filter(w => w <= short_max).length;
  const longCt = wordCounts.filter(w => w >= long_min && w <= 35).length;
  const veryLong = wordCounts.filter(w => w >= 36).length;
  const medium = wordCounts.length - short - longCt - veryLong;

  const pct = (n: number) => Math.round((n / wordCounts.length) * 100);

  return {
    average_length: Math.round(avg * 10) / 10,
    short_pct: pct(short),
    medium_pct: pct(medium),
    long_pct: pct(longCt),
    very_long_pct: pct(veryLong),
    short_max_words: short_max,
    long_min_words: long_min,
  };
}

// ─── Avoid-Block Assembly ───────────────────────────────────────────────────

/**
 * Build the avoid block from the AI-tells tally + punctuation tally.
 *   - AI tells that FAIL the authenticity hurdle → `NEVER "X".`
 *     (count of 0 OR below per-category volume/rate threshold — the latter
 *     catches AI-contaminated samples smuggled into the corpus where a tell
 *     appears once or twice without being part of the author's real habit).
 *     Routed by catalog category: word/transition/phrase → diction;
 *     punctuation → punctuation.
 *   - AI tells that CLEAR the hurdle → skip. The author genuinely uses it;
 *     preserving voice outweighs suppressing the tell.
 *   - Punctuation marks with rate 0 that are NOT in AI-tells → `No X.`
 *
 *   Syntax avoid rules come from the LLM structural votes (emitted at
 *   AuthorVoiceAnalysis.ts assembly time), merged with any always-emit
 *   tally-derived syntax rules.
 */
export function buildAvoidBlock(tally: PunctuationTally, ai: AITellTally): {
  diction: string[];
  punctuation: string[];
} {
  const diction: string[] = [];
  const punctuation: string[] = [];

  // AI tells that fail the authenticity hurdle → emit NEVER rule.
  // (Below-hurdle usage is treated as corpus contamination, not signature voice.)
  const forbidSet = new Set(ai.forbid_labels);
  for (const tell of AI_TELLS) {
    if (!forbidSet.has(tell.label)) continue; // cleared the hurdle, preserve voice
    const line = `NEVER "${tell.label}".`;
    if (tell.category === 'punctuation') punctuation.push(line);
    else diction.push(line); // words/transitions/phrases all render under diction
  }

  // Punctuation never-uses not already covered by AI-tells catalog.
  const neverMap: Record<string, string> = {
    em_dash: 'em-dashes',
    en_dash: 'en-dashes',
    semicolon: 'semicolons',
    colon: 'colons',
    ellipsis: 'ellipses',
    bracket: 'square brackets',
    double_quote_curly: 'curly double quotes',
    single_quote_curly: 'curly single quotes / apostrophes',
    exclamation: 'exclamation marks',
    paren_pair: 'parentheses',
  };
  for (const [key, nicename] of Object.entries(neverMap)) {
    if (tally.category[key] !== 'never') continue;
    // Skip if already emitted by AI-tells pass (em_dash handled there via "em-dashes" label).
    const alreadyEmitted = AI_TELL_LABELS.has(nicename);
    if (alreadyEmitted) continue;
    punctuation.push(`No ${nicename}.`);
  }

  return { diction, punctuation };
}

/**
 * Merge structural-pattern LLM votes into avoid.diction / avoid.syntax.
 * vote: true = author uses the pattern → skip. vote: false = NEVER rule.
 * Exception: patterns marked `unconditional` always emit a NEVER, regardless
 * of vote — some tells are too broken to permit even when the corpus shows
 * usage (e.g. contrastive negation).
 */
export function applyStructuralVotes(
  avoid: { diction: string[]; syntax: string[]; punctuation: string[] },
  votes: Record<string, boolean>
): void {
  for (const pattern of AI_STRUCTURAL_PATTERNS) {
    const used = votes[pattern.key];
    if (used === true && !pattern.unconditional) continue; // author uses it, preserve voice
    // Treat undefined as "absent" to be safe — LLM should have voted, but if
    // missing we default to forbidding the AI-tell pattern.
    if (pattern.category === 'diction') avoid.diction.push(pattern.negative_rule);
    else if (pattern.category === 'syntax') avoid.syntax.push(pattern.negative_rule);
    else avoid.punctuation.push(pattern.negative_rule);
  }
}

// ─── Public Orchestrator ────────────────────────────────────────────────────

export interface DeterministicExtraction {
  punctuation_tally: PunctuationTally;
  ai_tell_tally: AITellTally;
  fingerprint_set: FingerprintSet;
  signature_set: SignatureSet;
  sentence_distribution: SentenceDistribution;
  /** Rendered one-line fingerprint rules (for the profile body). */
  fingerprints: string[];
  /** Rendered one-line signature rules (voice tics the author uses habitually). */
  signature: string[];
  /** Partial avoid block — structural LLM votes must be merged in. */
  avoid_partial: { diction: string[]; syntax: string[]; punctuation: string[] };
  /** The structural patterns the LLM must vote yes/no on. */
  structural_patterns: AIStructuralPattern[];
}

export function extractDeterministic(corpus: string): DeterministicExtraction {
  const punctuation_tally = computePunctuationFrequencies(corpus);
  const ai_tell_tally = computeAITellTally(corpus, punctuation_tally.words);
  const fingerprint_set = detectFingerprints(corpus);
  const signature_set = detectSignatures(corpus, punctuation_tally.words);
  const sentence_distribution = computeSentenceDistribution(corpus);

  const { diction, punctuation } = buildAvoidBlock(punctuation_tally, ai_tell_tally);

  return {
    punctuation_tally,
    ai_tell_tally,
    fingerprint_set,
    signature_set,
    sentence_distribution,
    fingerprints: renderFingerprints(fingerprint_set),
    signature: renderSignature(signature_set),
    avoid_partial: { diction, syntax: [], punctuation },
    structural_patterns: AI_STRUCTURAL_PATTERNS,
  };
}

// ─── Prompt Rendering Helpers ───────────────────────────────────────────────

/** Plain-text tally table for prompt injection (unchanged from prior design). */
export function renderTallyTable(tally: PunctuationTally): string {
  return Object.keys(tally.per1k).map(k => {
    const rate = tally.per1k[k].toFixed(2);
    const cat = tally.category[k].toUpperCase();
    return `  ${k.padEnd(25)} ${rate.padStart(6)}/1k   ${cat}`;
  }).join('\n');
}

/** Render the structural-pattern vote prompt the LLM answers yes/no on. */
export function renderStructuralVotePrompt(): string {
  return AI_STRUCTURAL_PATTERNS.map((p, i) =>
    `${i + 1}. "${p.key}": ${p.description}`
  ).join('\n');
}
