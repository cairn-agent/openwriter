/**
 * @file FingerprintDetector.ts
 * @description Deterministic detection of exact-presentation choices
 *   that RAG cannot reliably convey from retrieved chunks alone.
 *
 *   Each fingerprint is a binary or enumerable choice the author made
 *   consistently (em-dash spacing, Oxford comma, quote style, etc.).
 *   LLMs do not generalize these reliably from 3–5 examples — they fall
 *   back to training-data defaults. So we measure them in code and emit
 *   a one-line rule the renderer can stamp into the system prompt.
 *
 *   All detectors are pure functions over a corpus string. No LLM.
 *   Unknown / insufficient-evidence cases yield 'n/a' so the renderer
 *   can omit them.
 */

export type Fingerprint<T extends string> =
  | { value: T; confidence: 'low' | 'medium' | 'high' }
  | { value: 'n/a'; confidence: 'low' };

export interface FingerprintSet {
  em_dash_spacing: Fingerprint<'spaced' | 'unspaced' | 'mixed'>;
  ellipsis_style: Fingerprint<'three_dots' | 'unicode' | 'spaced_dots' | 'mixed'>;
  sentence_initial_conjunction_caps: Fingerprint<'caps' | 'lower' | 'mixed'>;
  oxford_comma: Fingerprint<'yes' | 'no' | 'mixed'>;
  quote_style: Fingerprint<'straight' | 'curly' | 'mixed'>;
  capitalization_after_colon: Fingerprint<'upper' | 'lower' | 'mixed'>;
  numerals_threshold: Fingerprint<'under_10' | 'under_100' | 'always_numeral' | 'always_spelled' | 'mixed'>;
  contractions: Fingerprint<'yes' | 'no' | 'mixed'>;
  compound_modifier_hyphen: Fingerprint<'yes' | 'no' | 'mixed'>;
  paragraph_length: Fingerprint<'short' | 'medium' | 'long' | 'mixed'>;
  space_after_period: Fingerprint<'single' | 'double' | 'mixed'>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

function ratio(a: number, b: number): number {
  const total = a + b;
  if (total === 0) return 0;
  return a / total;
}

/**
 * Decide a binary fingerprint from two counters.
 * - Needs ≥3 total observations for any finding; otherwise 'n/a'.
 * - ≥85% one side → that side with high confidence.
 * - ≥70% → medium confidence.
 * - Otherwise 'mixed'.
 */
function decideBinary<A extends string, B extends string>(
  a: number, aLabel: A,
  b: number, bLabel: B,
  mixedLabel: 'mixed' = 'mixed'
): Fingerprint<A | B | 'mixed'> {
  const total = a + b;
  if (total < 3) return { value: 'n/a', confidence: 'low' };
  const r = ratio(a, b);
  if (r >= 0.85) return { value: aLabel, confidence: 'high' };
  if (r <= 0.15) return { value: bLabel, confidence: 'high' };
  if (r >= 0.70) return { value: aLabel, confidence: 'medium' };
  if (r <= 0.30) return { value: bLabel, confidence: 'medium' };
  return { value: mixedLabel, confidence: 'low' };
}

// ─── Detectors ───────────────────────────────────────────────────────────────

function detectEmDashSpacing(text: string): FingerprintSet['em_dash_spacing'] {
  const spaced = countMatches(text, /\s\u2014\s/g);
  const unspaced = countMatches(text, /\S\u2014\S/g);
  return decideBinary(spaced, 'spaced', unspaced, 'unspaced');
}

function detectEllipsisStyle(text: string): FingerprintSet['ellipsis_style'] {
  const threeDots = countMatches(text, /(?<!\.)\.\.\.(?!\.)/g);
  const unicode = countMatches(text, /\u2026/g);
  const spacedDots = countMatches(text, /\. \. \./g);

  const total = threeDots + unicode + spacedDots;
  if (total < 3) return { value: 'n/a', confidence: 'low' };

  const max = Math.max(threeDots, unicode, spacedDots);
  if (max / total >= 0.85) {
    const value =
      max === threeDots ? 'three_dots' :
      max === unicode   ? 'unicode'    : 'spaced_dots';
    return { value, confidence: 'high' };
  }
  return { value: 'mixed', confidence: 'low' };
}

function detectSentenceInitialConjunctionCaps(text: string): FingerprintSet['sentence_initial_conjunction_caps'] {
  // Look at "But", "And", "So", "Or", "Yet" after sentence terminator.
  const caps = countMatches(text, /[.!?]\s+(?:But|And|So|Or|Yet)\b/g);
  const lower = countMatches(text, /[.!?]\s+(?:but|and|so|or|yet)\b/g);
  return decideBinary(caps, 'caps', lower, 'lower');
}

function detectOxfordComma(text: string): FingerprintSet['oxford_comma'] {
  // Look for 3+ item lists. Oxford: "a, b, and c" / No Oxford: "a, b and c"
  // Pattern captures the final comma-or-no before "and".
  const withOxford = countMatches(text, /\w+,\s\w+[\w\s]*,\s(?:and|or)\s\w+/g);
  const withoutOxford = countMatches(text, /\w+,\s\w+[\w\s]*\s(?:and|or)\s\w+(?![\w\s]*,)/g);
  return decideBinary(withOxford, 'yes', withoutOxford, 'no');
}

function detectQuoteStyle(text: string): FingerprintSet['quote_style'] {
  const straight = countMatches(text, /"/g);
  const curly = countMatches(text, /[\u201C\u201D]/g);
  return decideBinary(straight, 'straight', curly, 'curly');
}

function detectCapitalizationAfterColon(text: string): FingerprintSet['capitalization_after_colon'] {
  const upper = countMatches(text, /:\s[A-Z]/g);
  const lower = countMatches(text, /:\s[a-z]/g);
  return decideBinary(upper, 'upper', lower, 'lower');
}

function detectNumeralsThreshold(text: string): FingerprintSet['numerals_threshold'] {
  // Count digit-numerals below 10 and between 10-99 and 100+.
  const smallDigit  = countMatches(text, /\b[0-9]\b/g);            // 0–9
  const midDigit    = countMatches(text, /\b[1-9][0-9]\b/g);       // 10–99
  const largeDigit  = countMatches(text, /\b[1-9][0-9]{2,}\b/g);   // 100+

  // Spelled numbers under 10 and teen/tens under 100.
  const smallSpelled = countMatches(text, /\b(?:one|two|three|four|five|six|seven|eight|nine)\b/gi);
  const midSpelled   = countMatches(text, /\b(?:ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi);

  const anyDigit = smallDigit + midDigit + largeDigit;
  const anySpelled = smallSpelled + midSpelled;
  if (anyDigit + anySpelled < 5) return { value: 'n/a', confidence: 'low' };

  // If small numbers are mostly spelled and mid/large are mostly digits → "under_10"
  const smallSpelledRatio = smallSpelled / Math.max(1, smallDigit + smallSpelled);
  const midDigitRatio = midDigit / Math.max(1, midDigit + midSpelled);

  if (smallSpelledRatio >= 0.7 && midDigitRatio >= 0.7) {
    return { value: 'under_10', confidence: 'medium' };
  }
  if (smallSpelledRatio >= 0.7 && largeDigit > 0 && midSpelled >= midDigit) {
    return { value: 'under_100', confidence: 'medium' };
  }
  if (anySpelled === 0 && anyDigit >= 5) {
    return { value: 'always_numeral', confidence: 'medium' };
  }
  if (anyDigit === 0 && anySpelled >= 5) {
    return { value: 'always_spelled', confidence: 'medium' };
  }
  return { value: 'mixed', confidence: 'low' };
}

function detectContractions(text: string): FingerprintSet['contractions'] {
  // Contraction: a word with apostrophe-s/re/ve/ll/d/t/m/n't at the end.
  const contracted = countMatches(text, /\b\w+['\u2019](?:s|re|ve|ll|d|t|m)\b/gi);
  // Expanded forms — approximate by counting known expansions.
  const expanded =
    countMatches(text, /\b(?:do not|does not|did not|is not|are not|was not|were not|cannot|will not|would not|should not|could not|have not|has not|had not|I am|you are|we are|they are|it is|that is|there is|let us)\b/gi);
  return decideBinary(contracted, 'yes', expanded, 'no');
}

function detectCompoundModifierHyphen(text: string): FingerprintSet['compound_modifier_hyphen'] {
  // Rough heuristic: hyphenated adj+noun in attributive position ("well-known X", "state-of-the-art X").
  const hyphenated = countMatches(text, /\b\w+-\w+\s+\w+/g);
  // Spaced version of the same construction is impossible to distinguish from general prose,
  // so we fall back to whether the author uses hyphenation at all.
  if (hyphenated >= 5) return { value: 'yes', confidence: 'medium' };
  if (hyphenated === 0) return { value: 'no', confidence: 'medium' };
  return { value: 'mixed', confidence: 'low' };
}

function detectParagraphLength(text: string): FingerprintSet['paragraph_length'] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  if (paragraphs.length < 3) return { value: 'n/a', confidence: 'low' };

  const sentenceCounts = paragraphs.map(p =>
    p.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0).length
  );
  const avg = sentenceCounts.reduce((a, b) => a + b, 0) / sentenceCounts.length;

  if (avg <= 2) return { value: 'short', confidence: 'high' };
  if (avg <= 4) return { value: 'medium', confidence: 'high' };
  if (avg >= 6) return { value: 'long', confidence: 'high' };
  return { value: 'mixed', confidence: 'medium' };
}

function detectSpaceAfterPeriod(text: string): FingerprintSet['space_after_period'] {
  const single = countMatches(text, /\.\s(?=[A-Z])/g);
  const double = countMatches(text, /\.\s\s(?=[A-Z])/g);
  // Note: double-space matches also match single-space regex. Subtract.
  const onlySingle = single - double;
  return decideBinary(onlySingle, 'single', double, 'double');
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function detectFingerprints(corpus: string): FingerprintSet {
  return {
    em_dash_spacing: detectEmDashSpacing(corpus),
    ellipsis_style: detectEllipsisStyle(corpus),
    sentence_initial_conjunction_caps: detectSentenceInitialConjunctionCaps(corpus),
    oxford_comma: detectOxfordComma(corpus),
    quote_style: detectQuoteStyle(corpus),
    capitalization_after_colon: detectCapitalizationAfterColon(corpus),
    numerals_threshold: detectNumeralsThreshold(corpus),
    contractions: detectContractions(corpus),
    compound_modifier_hyphen: detectCompoundModifierHyphen(corpus),
    paragraph_length: detectParagraphLength(corpus),
    space_after_period: detectSpaceAfterPeriod(corpus),
  };
}

/** Render a fingerprint set as telegraphic one-liners. Unknown values omitted. */
export function renderFingerprints(fp: FingerprintSet): string[] {
  const lines: string[] = [];
  const push = (label: string, v: Fingerprint<string>, map: Record<string, string>) => {
    if (v.value === 'n/a') return;
    const readable = map[v.value] ?? v.value;
    lines.push(`${label}: ${readable}`);
  };

  push('Em-dash spacing', fp.em_dash_spacing, {
    spaced: 'word — word', unspaced: 'word—word', mixed: 'inconsistent',
  });
  push('Ellipsis style', fp.ellipsis_style, {
    three_dots: '...', unicode: '…', spaced_dots: '. . .', mixed: 'inconsistent',
  });
  push('Sentence-initial "But/And/So"', fp.sentence_initial_conjunction_caps, {
    caps: 'capitalized (". But")', lower: 'lowercase (", but")', mixed: 'inconsistent',
  });
  push('Oxford comma', fp.oxford_comma, { yes: 'yes', no: 'no', mixed: 'inconsistent' });
  push('Quote style', fp.quote_style, {
    straight: 'straight "..."', curly: 'curly \u201C...\u201D', mixed: 'inconsistent',
  });
  push('Capitalization after colon', fp.capitalization_after_colon, {
    upper: 'upper', lower: 'lower', mixed: 'inconsistent',
  });
  push('Numerals', fp.numerals_threshold, {
    under_10: 'spell out under 10, numerals for 10+',
    under_100: 'spell out under 100, numerals for 100+',
    always_numeral: 'always numerals',
    always_spelled: 'always spelled out',
    mixed: 'inconsistent',
  });
  push('Contractions', fp.contractions, {
    yes: 'uses contractions', no: 'avoids contractions', mixed: 'mixed',
  });
  push('Compound-modifier hyphens', fp.compound_modifier_hyphen, {
    yes: 'hyphenates (well-known)', no: 'spaces (well known)', mixed: 'inconsistent',
  });
  push('Paragraph length', fp.paragraph_length, {
    short: '1–2 sentences', medium: '3–4 sentences', long: '5+ sentences', mixed: 'varied',
  });
  push('Space after period', fp.space_after_period, {
    single: 'single', double: 'double', mixed: 'inconsistent',
  });
  return lines;
}
