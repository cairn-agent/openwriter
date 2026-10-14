/**
 * @file SignatureDetector.ts
 * @description Positive-signature detector — the inverse of the AI-tell
 *   suppression path. Measures voice tics the author reaches for habitually
 *   (intensifiers, hedges, emphatics, discourse openers, epistemic phrases,
 *   frequency and attitude markers) and structural habits (parentheticals,
 *   questions, exclamations, one-word sentences, italicized emphasis).
 *
 *   Why this exists: RAG chunks contain the words but the LLM doesn't know
 *   which ones are habit vs. incidental. The signature block closes that
 *   gap — it tells the LLM "these are the tics this author reaches for, at
 *   roughly this rate — mimic them."
 *
 *   All thresholds are tuned to surface signal, not noise. A tic must clear
 *   both a raw count AND a rate floor to be called signature.
 */

import {
  SIGNATURE_TICS,
  SignatureCategory,
} from './SignatureCatalog.js';

// ─── Thresholds ─────────────────────────────────────────────────────────────
// Habit gate (not a contamination gate). A tic must appear often enough AND
// at a high enough rate that an imitating LLM should reach for it too.
// Per-category because base rates differ — discourse openers are rare by
// position (sentence-initial only), epistemics skew lower because they're
// multi-word, single-word intensifiers/emphatics/frequency adverbs sit higher.
export const SIGNATURE_THRESHOLDS: Record<SignatureCategory, { min_count: number; min_rate_per_1k: number }> = {
  intensifier: { min_count: 3, min_rate_per_1k: 0.30 },
  hedge:       { min_count: 3, min_rate_per_1k: 0.30 },
  emphatic:    { min_count: 3, min_rate_per_1k: 0.30 },
  discourse:   { min_count: 2, min_rate_per_1k: 0.15 },
  epistemic:   { min_count: 3, min_rate_per_1k: 0.20 },
  frequency:   { min_count: 3, min_rate_per_1k: 0.30 },
  attitude:    { min_count: 2, min_rate_per_1k: 0.15 },
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SignatureTicHit {
  label: string;
  category: SignatureCategory;
  count: number;
  rate_per_1k: number;
}

export interface StructuralHabits {
  parenthetical_rate_per_1k: number;
  parenthetical_level: 'none' | 'light' | 'moderate' | 'heavy';
  /** % of sentences that are questions */
  question_pct: number;
  /** % of sentences ending in ! */
  exclamation_pct: number;
  /** % of sentences that are a single word */
  one_word_sentence_pct: number;
  /** italicized emphasis (*word* / _word_) per 1k words */
  italic_rate_per_1k: number;
}

export interface SignatureSet {
  tics: SignatureTicHit[];
  habits: StructuralHabits;
}

// ─── Tic Detection ──────────────────────────────────────────────────────────

export function detectSignatureTics(corpus: string, words: number): SignatureTicHit[] {
  const total = Math.max(1, words);
  const hits: SignatureTicHit[] = [];

  for (const tic of SIGNATURE_TICS) {
    tic.pattern.lastIndex = 0;
    const n = (corpus.match(tic.pattern) || []).length;
    if (n === 0) continue;
    const rate = (n / total) * 1000;
    const t = SIGNATURE_THRESHOLDS[tic.category];
    if (n < t.min_count || rate < t.min_rate_per_1k) continue;
    hits.push({
      label: tic.label,
      category: tic.category,
      count: n,
      rate_per_1k: Math.round(rate * 100) / 100,
    });
  }

  // Sort by rate desc so the most habitual tics render first.
  hits.sort((a, b) => b.rate_per_1k - a.rate_per_1k);
  return hits;
}

// ─── Structural Habits ──────────────────────────────────────────────────────

export function detectStructuralHabits(corpus: string, words: number): StructuralHabits {
  const total = Math.max(1, words);
  const sentences = corpus.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  const sentCount = Math.max(1, sentences.length);

  const parenOpen = (corpus.match(/\(/g) || []).length;
  const parenClose = (corpus.match(/\)/g) || []).length;
  const paren = Math.min(parenOpen, parenClose);
  const parenRate = (paren / total) * 1000;
  const parenLevel: StructuralHabits['parenthetical_level'] =
    parenRate === 0 ? 'none' : parenRate < 1 ? 'light' : parenRate < 3 ? 'moderate' : 'heavy';

  const questions = sentences.filter(s => /\?\s*$/.test(s.trim())).length;
  const exclamations = sentences.filter(s => /!\s*$/.test(s.trim())).length;
  const oneWord = sentences.filter(s => {
    const stripped = s.trim().replace(/[.!?"'\)\]\u201D\u2019]+$/, '').trim();
    if (stripped.length === 0) return false;
    return stripped.split(/\s+/).length === 1;
  }).length;

  // Markdown italics in plain text: *word* or _word_ (but not **bold** or __bold__).
  // We use a non-greedy match anchored by word characters on both sides.
  const italicMatches = corpus.match(/(?:^|[\s(])(\*[A-Za-z][^*\n]*?[A-Za-z]\*|_[A-Za-z][^_\n]*?[A-Za-z]_)(?=[\s.,;:!?)]|$)/g) || [];
  // Filter out **bold** accidentally matching *...* via outer pair
  const italic = italicMatches.filter(m => !/\*\*|__/.test(m)).length;

  return {
    parenthetical_rate_per_1k: Math.round(parenRate * 100) / 100,
    parenthetical_level: parenLevel,
    question_pct: Math.round((questions / sentCount) * 1000) / 10,
    exclamation_pct: Math.round((exclamations / sentCount) * 1000) / 10,
    one_word_sentence_pct: Math.round((oneWord / sentCount) * 1000) / 10,
    italic_rate_per_1k: Math.round((italic / total) * 1000 * 100) / 100,
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export function detectSignatures(corpus: string, words: number): SignatureSet {
  return {
    tics: detectSignatureTics(corpus, words),
    habits: detectStructuralHabits(corpus, words),
  };
}

// ─── Render ─────────────────────────────────────────────────────────────────

const CAT_LABEL: Record<SignatureCategory, string> = {
  intensifier: 'Intensifiers',
  hedge: 'Hedges',
  emphatic: 'Emphatics',
  discourse: 'Discourse openers',
  epistemic: 'Epistemic phrases',
  frequency: 'Frequency adverbs',
  attitude: 'Attitude markers',
};

/**
 * Render the signature set to one-line rules for the system prompt. Output
 * is positive/descriptive — "use these habitually" — not NEVER rules.
 *
 * Capped by `maxTics` (default 10) to avoid cognitive-load dilution. The
 * negative-first architecture's whole point is terse rules; this block is
 * no exception.
 */
export function renderSignature(set: SignatureSet, maxTics: number = 10): string[] {
  const out: string[] = [];

  if (set.tics.length > 0) {
    // Group by category so the LLM sees "these are the author's intensifiers"
    // rather than a flat, uncategorized list.
    const top = set.tics.slice(0, maxTics);
    const byCat = new Map<SignatureCategory, SignatureTicHit[]>();
    for (const tic of top) {
      const arr = byCat.get(tic.category) || [];
      arr.push(tic);
      byCat.set(tic.category, arr);
    }
    // Emit in catalog-category order (stable, matches SignatureCatalog.ts order).
    const order: SignatureCategory[] = [
      'intensifier', 'hedge', 'emphatic', 'discourse',
      'epistemic', 'frequency', 'attitude',
    ];
    for (const cat of order) {
      const hits = byCat.get(cat);
      if (!hits || hits.length === 0) continue;
      const labels = hits.map(h => `"${h.label}"`).join(', ');
      out.push(`${CAT_LABEL[cat]} (habitual): ${labels}`);
    }
  }

  const h = set.habits;
  if (h.parenthetical_level === 'moderate' || h.parenthetical_level === 'heavy') {
    out.push(`Parenthetical asides: ${h.parenthetical_level} (~${h.parenthetical_rate_per_1k}/1k words)`);
  }
  if (h.question_pct >= 3) {
    out.push(`Rhetorical questions: ${h.question_pct}% of sentences`);
  }
  if (h.exclamation_pct >= 2) {
    out.push(`Exclamations: ${h.exclamation_pct}% of sentences`);
  }
  if (h.one_word_sentence_pct >= 1) {
    out.push(`One-word sentences: ${h.one_word_sentence_pct}% of sentences`);
  }
  if (h.italic_rate_per_1k >= 0.5) {
    out.push(`Italicized emphasis: ~${h.italic_rate_per_1k}/1k words`);
  }

  return out;
}
