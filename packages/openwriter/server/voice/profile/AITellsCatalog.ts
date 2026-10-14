/**
 * @file AITellsCatalog.ts
 * @description Canonical catalog of AI-generated-text tells.
 *
 *   Role in the pipeline: severity multiplier, NOT an inclusion filter.
 *   An item here only becomes a negative rule if the author's corpus
 *   shows rate 0 for it. Authors who legitimately use "Moreover" get no
 *   rule about it — preserving their voice. Authors who never use it
 *   get a hardened `NEVER "Moreover".` rule because the item is on this
 *   list.
 *
 *   Curated from:
 *   - breewriter analysis-prompt.txt + ai-detection-words-phrases.md
 *   - 2026 AI-detection research (Pangram, Originality, Wikipedia
 *     "Signs of AI writing", Grammarly, Goedecke on em-dashes)
 *
 *   Scope: ~60 deterministic items covering the 80/20 of AI tells.
 *   Plus 5 structural patterns that need an LLM binary vote (see
 *   AI_STRUCTURAL_PATTERNS) because they have too many surface forms to
 *   regex reliably.
 */

export type AITellCategory = 'word' | 'transition' | 'phrase' | 'punctuation';

export interface AITell {
  /** Display label for the rule output. */
  label: string;
  /** Case-insensitive regex matched against the corpus. */
  pattern: RegExp;
  /** Which profile category the resulting rule renders under. */
  category: AITellCategory;
}

/** Word-boundary helper — case-insensitive match on a literal word. */
const w = (word: string): RegExp => new RegExp(`\\b${word}\\b`, 'gi');
/** Literal phrase, case-insensitive. */
const p = (phrase: string): RegExp => new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
/** Sentence-initial word — follows start of corpus or a sentence terminator. */
const si = (word: string): RegExp => new RegExp(`(?:^|[.!?]\\s+)${word}\\b`, 'g');

// ─── Sophisticated-Vocabulary Overuse (words) ────────────────────────────────
// The 25 highest-signal single words across 2023–2026 research.

export const AI_WORDS: AITell[] = [
  { label: 'delve',          pattern: w('delve'),          category: 'word' },
  { label: 'delves',         pattern: w('delves'),         category: 'word' },
  { label: 'pivotal',        pattern: w('pivotal'),        category: 'word' },
  { label: 'tapestry',       pattern: w('tapestry'),       category: 'word' },
  { label: 'realm',          pattern: w('realm'),          category: 'word' },
  { label: 'beacon',         pattern: w('beacon'),         category: 'word' },
  { label: 'harness',        pattern: w('harness'),        category: 'word' },
  { label: 'illuminate',     pattern: w('illuminate'),     category: 'word' },
  { label: 'underscore',     pattern: w('underscores?'),   category: 'word' },
  { label: 'bolster',        pattern: w('bolsters?'),      category: 'word' },
  { label: 'facilitate',     pattern: w('facilitates?'),   category: 'word' },
  { label: 'multifaceted',   pattern: w('multifaceted'),   category: 'word' },
  { label: 'foster',         pattern: w('fosters?'),       category: 'word' },
  { label: 'crucial',        pattern: w('crucial'),        category: 'word' },
  { label: 'vital',          pattern: w('vital'),          category: 'word' },
  { label: 'comprehensive',  pattern: w('comprehensive'),  category: 'word' },
  { label: 'robust',         pattern: w('robust'),         category: 'word' },
  { label: 'leverage',       pattern: w('leverages?'),     category: 'word' },
  { label: 'seamless',       pattern: w('seamless(?:ly)?'), category: 'word' },
  { label: 'navigate',       pattern: w('navigates?'),     category: 'word' },
  { label: 'embark',         pattern: w('embarks?'),       category: 'word' },
  { label: 'nestled',        pattern: w('nestled'),        category: 'word' },
  { label: 'unwavering',     pattern: w('unwavering'),     category: 'word' },
  { label: 'indelible',      pattern: w('indelible'),      category: 'word' },
  { label: 'meticulous',     pattern: w('meticulous(?:ly)?'), category: 'word' },
  { label: 'transformative', pattern: w('transformative'), category: 'word' },
  { label: 'revolutionize',  pattern: w('revolutioni[sz]e'), category: 'word' },
];

// ─── Robotic Transitions ─────────────────────────────────────────────────────
// Sentence-initial checks where relevant — AI uses these as paragraph scaffolding.

export const AI_TRANSITIONS: AITell[] = [
  { label: 'Moreover',        pattern: si('Moreover'),        category: 'transition' },
  { label: 'Furthermore',     pattern: si('Furthermore'),     category: 'transition' },
  { label: 'Notably',         pattern: si('Notably'),         category: 'transition' },
  { label: 'Additionally',    pattern: si('Additionally'),    category: 'transition' },
  { label: 'Consequently',    pattern: si('Consequently'),    category: 'transition' },
  { label: 'Ultimately',      pattern: si('Ultimately'),      category: 'transition' },
  { label: 'Therefore (sentence-initial)', pattern: si('Therefore'), category: 'transition' },
  { label: 'However (sentence-initial)',   pattern: si('However'),   category: 'transition' },
  { label: 'Indeed',          pattern: si('Indeed'),          category: 'transition' },
  { label: 'Thus',            pattern: si('Thus'),            category: 'transition' },
  { label: 'Subsequently',    pattern: si('Subsequently'),    category: 'transition' },
  { label: 'Nonetheless',     pattern: si('Nonetheless'),     category: 'transition' },
  { label: 'Firstly',         pattern: si('Firstly'),         category: 'transition' },
  { label: 'In conclusion',   pattern: p('in conclusion'),    category: 'transition' },
];

// ─── High-Frequency AI Phrases (50x–900x more frequent in AI) ───────────────
// Pulled from Pangram frequency analysis and Breewriter's top offenders.

export const AI_PHRASES: AITell[] = [
  { label: 'provide(s) valuable insights', pattern: p('provides? valuable insights'),  category: 'phrase' },
  { label: 'gain(s) valuable insights',    pattern: p('gains? valuable insights'),     category: 'phrase' },
  { label: 'valuable insights',            pattern: p('valuable insights'),            category: 'phrase' },
  { label: 'a rich tapestry',              pattern: p('a rich tapestry'),              category: 'phrase' },
  { label: 'plays a crucial role',         pattern: p('plays a crucial role'),         category: 'phrase' },
  { label: 'in today\'s digital age/era',  pattern: /in today[\u2019']s digital (?:age|era)/gi, category: 'phrase' },
  { label: 'in the fast-paced world',      pattern: /in (?:today[\u2019']s |the )?fast[- ]paced world/gi, category: 'phrase' },
  { label: 'at its core',                  pattern: p('at its core'),                  category: 'phrase' },
  { label: 'that being said',              pattern: p('that being said'),              category: 'phrase' },
  { label: 'to put it simply',             pattern: p('to put it simply'),             category: 'phrase' },
  { label: 'it\'s worth noting',           pattern: /it[\u2019']s worth noting/gi,     category: 'phrase' },
  { label: 'it\'s important to note',      pattern: /it[\u2019']s important to note/gi, category: 'phrase' },
  { label: 'delve into',                   pattern: p('delve into'),                   category: 'phrase' },
  { label: 'dive into',                    pattern: p('dive into'),                    category: 'phrase' },
  { label: 'navigate the complexities',    pattern: p('navigat(?:e|ing) the complexit'), category: 'phrase' },
  { label: 'the intricate relationship',   pattern: p('the intricate relationship'),   category: 'phrase' },
  { label: 'a nuanced understanding',      pattern: p('a nuanced understanding'),      category: 'phrase' },
  { label: 'opens new avenues',            pattern: p('opens? new avenues'),           category: 'phrase' },
  { label: 'leaves an indelible mark',     pattern: p('leaves? an indelible mark'),    category: 'phrase' },
  { label: 'stands as a testament',        pattern: p('stands? as a testament'),       category: 'phrase' },
  { label: 'paves the way',                pattern: p('paves? the way'),               category: 'phrase' },
  { label: 'a stark reminder',             pattern: p('a stark reminder'),             category: 'phrase' },
  { label: 'a beacon of',                  pattern: p('a beacon of'),                  category: 'phrase' },
];

// ─── Em-Dash (punctuation, highest 2026 detection signal) ───────────────────
// The em-dash is checked separately by the punctuation tally; listed here
// only so the tally can look it up as an AI-tell when rendering rules.

export const AI_PUNCTUATION: AITell[] = [
  { label: 'em-dashes',   pattern: /\u2014/g, category: 'punctuation' },
];

/** Flat list used by the extractor to scan every item. */
export const AI_TELLS: AITell[] = [
  ...AI_WORDS,
  ...AI_TRANSITIONS,
  ...AI_PHRASES,
  ...AI_PUNCTUATION,
];

/**
 * Set of labels from AI_PUNCTUATION + AI_WORDS + AI_TRANSITIONS + AI_PHRASES
 * for O(1) "is this item an AI tell?" lookups from other extractors (e.g.
 * the punctuation tally, which checks em-dash separately).
 */
export const AI_TELL_LABELS: Set<string> = new Set(AI_TELLS.map(t => t.label));

// ─── Structural Patterns (need LLM binary vote) ──────────────────────────────
// Too many surface forms to regex reliably. The LLM's job is NOT to write
// rules — only to answer yes/no on presence. Code emits the rule string.

export interface AIStructuralPattern {
  key: string;
  /** One-line description given to the LLM for its binary vote. */
  description: string;
  /** Rule emitted if the author does NOT use this pattern. */
  negative_rule: string;
  /** Which category the negative rule renders under. */
  category: 'diction' | 'syntax' | 'punctuation';
  /**
   * When true, the NEVER rule is emitted regardless of the LLM vote — the
   * pattern is such a strong AI tell that we ban it universally, even for
   * authors whose corpus shows use of it. Treated the same way em-dashes
   * are treated by the punctuation tally (hurdle-based universal ban).
   */
  unconditional?: boolean;
}

export const AI_STRUCTURAL_PATTERNS: AIStructuralPattern[] = [
  {
    key: 'contrastive_negation',
    description: 'Contrastive negation ("It\'s not X, it\'s Y", "Not just X but Y", "Rather than X, Y", "Less X, more Y")',
    negative_rule: 'NEVER contrastive negation (It\'s not X, it\'s Y / Not just X but Y / Rather than X, Y).',
    category: 'syntax',
    // Broken, highly detectable AI pattern — banned universally regardless of corpus.
    unconditional: true,
  },
  {
    key: 'tricolon_abstractions',
    description: 'Rule-of-three lists of abstract nouns ("innovation, collaboration, and excellence") used as signature flourishes, not because three items were needed',
    negative_rule: 'NEVER rule-of-three lists of abstractions as a flourish.',
    category: 'syntax',
  },
  {
    key: 'soft_repetition',
    description: 'Soft repetition — restating the same point with only minor wording changes across consecutive sentences',
    negative_rule: 'NEVER restate the same point in the next sentence with minor wording changes.',
    category: 'syntax',
  },
  {
    key: 'mismatched_enthusiasm',
    description: 'Encouragement or enthusiasm levels that do not match the actual content (e.g., "what a fascinating question!" for a mundane query)',
    negative_rule: 'NEVER encouragement or enthusiasm beyond what the content warrants.',
    category: 'diction',
  },
  {
    key: 'representational_hedging',
    description: 'Telling the reader what things represent/symbolize/reflect ("this underscores the importance of...", "this stands as a testament to...", "this reflects the broader...") instead of stating facts directly',
    negative_rule: 'NEVER telling the reader what things "represent", "underscore", "reflect", or "stand as a testament to".',
    category: 'syntax',
  },
];

export const STRUCTURAL_KEYS: string[] = AI_STRUCTURAL_PATTERNS.map(s => s.key);
