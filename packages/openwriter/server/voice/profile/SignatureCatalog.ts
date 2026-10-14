/**
 * @file SignatureCatalog.ts
 * @description Positive-signature catalog — voice tics the author may
 *   reach for. Inverse of AITellsCatalog: instead of "AI uses these, so
 *   the author should avoid them unless they habitually use them," this
 *   asks "the author may use these; if they do, surface them so the LLM
 *   mimics the rate."
 *
 *   The detector measures rate per 1k words for each tic and emits the
 *   author's "top N" signature tics — the words/phrases they reach for
 *   unusually often. This closes the gap where RAG chunks contain the
 *   words but the LLM doesn't know which ones are habitual tics vs.
 *   incidental usage.
 *
 *   Scope: discourse markers, intensifiers, hedges, emphatics, epistemic
 *   phrases, frequency adverbs, attitude markers. Explicitly NOT topic
 *   nouns — those are topic, not voice.
 */

export type SignatureCategory =
  | 'intensifier'
  | 'hedge'
  | 'emphatic'
  | 'discourse'
  | 'epistemic'
  | 'frequency'
  | 'attitude';

export interface SignatureTic {
  /** Rendered word/phrase — what appears in the prompt. */
  label: string;
  /** Case-insensitive, word-boundary-anchored regex for counting instances. */
  pattern: RegExp;
  category: SignatureCategory;
}

// ─── Intensifiers ──────────────────────────────────────────────────────────
// Words that crank up the strength of another word. High-signal tic — every
// writer has a favorite (Hemingway: almost none; Thompson: "fucking"; modern
// blogger: "incredibly" / "super").
export const SIG_INTENSIFIERS: SignatureTic[] = [
  { label: 'really',      pattern: /\breally\b/gi,      category: 'intensifier' },
  { label: 'very',        pattern: /\bvery\b/gi,        category: 'intensifier' },
  { label: 'quite',       pattern: /\bquite\b/gi,       category: 'intensifier' },
  { label: 'absolutely',  pattern: /\babsolutely\b/gi,  category: 'intensifier' },
  { label: 'totally',     pattern: /\btotally\b/gi,     category: 'intensifier' },
  { label: 'completely',  pattern: /\bcompletely\b/gi,  category: 'intensifier' },
  { label: 'utterly',     pattern: /\butterly\b/gi,     category: 'intensifier' },
  { label: 'extremely',   pattern: /\bextremely\b/gi,   category: 'intensifier' },
  { label: 'incredibly',  pattern: /\bincredibly\b/gi,  category: 'intensifier' },
  { label: 'super',       pattern: /\bsuper\b/gi,       category: 'intensifier' },
  { label: 'ridiculously',pattern: /\bridiculously\b/gi,category: 'intensifier' },
  { label: 'genuinely',   pattern: /\bgenuinely\b/gi,   category: 'intensifier' },
];

// ─── Hedges ────────────────────────────────────────────────────────────────
// Softeners that walk a claim back. Authors who hedge a lot have a measured,
// exploratory voice; authors who hedge rarely sound declarative.
export const SIG_HEDGES: SignatureTic[] = [
  { label: 'maybe',       pattern: /\bmaybe\b/gi,       category: 'hedge' },
  { label: 'perhaps',     pattern: /\bperhaps\b/gi,     category: 'hedge' },
  { label: 'probably',    pattern: /\bprobably\b/gi,    category: 'hedge' },
  { label: 'somewhat',    pattern: /\bsomewhat\b/gi,    category: 'hedge' },
  { label: 'mostly',      pattern: /\bmostly\b/gi,      category: 'hedge' },
  { label: 'largely',     pattern: /\blargely\b/gi,     category: 'hedge' },
  { label: 'kind of',     pattern: /\bkind of\b/gi,     category: 'hedge' },
  { label: 'sort of',     pattern: /\bsort of\b/gi,     category: 'hedge' },
  { label: 'a bit',       pattern: /\ba bit\b/gi,       category: 'hedge' },
  { label: 'a little',    pattern: /\ba little\b/gi,    category: 'hedge' },
  { label: 'arguably',    pattern: /\barguably\b/gi,    category: 'hedge' },
  { label: 'seemingly',   pattern: /\bseemingly\b/gi,   category: 'hedge' },
];

// ─── Emphatics ─────────────────────────────────────────────────────────────
// Discourse markers that punctuate a claim with "pay attention — this bit."
// Signature territory: a writer's taste in emphatics (actually vs. honestly
// vs. literally) telegraphs register fast.
export const SIG_EMPHATICS: SignatureTic[] = [
  { label: 'actually',    pattern: /\bactually\b/gi,    category: 'emphatic' },
  { label: 'basically',   pattern: /\bbasically\b/gi,   category: 'emphatic' },
  { label: 'literally',   pattern: /\bliterally\b/gi,   category: 'emphatic' },
  { label: 'honestly',    pattern: /\bhonestly\b/gi,    category: 'emphatic' },
  { label: 'frankly',     pattern: /\bfrankly\b/gi,     category: 'emphatic' },
  { label: 'obviously',   pattern: /\bobviously\b/gi,   category: 'emphatic' },
  { label: 'clearly',     pattern: /\bclearly\b/gi,     category: 'emphatic' },
  { label: 'definitely',  pattern: /\bdefinitely\b/gi,  category: 'emphatic' },
  { label: 'simply',      pattern: /\bsimply\b/gi,      category: 'emphatic' },
  { label: 'exactly',     pattern: /\bexactly\b/gi,     category: 'emphatic' },
  { label: 'precisely',   pattern: /\bprecisely\b/gi,   category: 'emphatic' },
  { label: 'essentially', pattern: /\bessentially\b/gi, category: 'emphatic' },
];

// ─── Discourse markers ─────────────────────────────────────────────────────
// Conversation-opener words. Match only sentence-initial / post-punctuation
// to avoid hitting them as mid-sentence nouns or verbs.
export const SIG_DISCOURSE: SignatureTic[] = [
  { label: 'Look,',       pattern: /(?:^|[.!?]\s+)Look,/g,    category: 'discourse' },
  { label: 'Listen,',     pattern: /(?:^|[.!?]\s+)Listen,/g,  category: 'discourse' },
  { label: 'Well,',       pattern: /(?:^|[.!?]\s+)Well,/g,    category: 'discourse' },
  { label: 'Now,',        pattern: /(?:^|[.!?]\s+)Now,/g,     category: 'discourse' },
  { label: 'See,',        pattern: /(?:^|[.!?]\s+)See,/g,     category: 'discourse' },
  { label: 'Right,',      pattern: /(?:^|[.!?]\s+)Right,/g,   category: 'discourse' },
  { label: 'Anyway,',     pattern: /(?:^|[.!?]\s+)Anyway,?/g, category: 'discourse' },
  { label: 'Honestly,',   pattern: /(?:^|[.!?]\s+)Honestly,/g,category: 'discourse' },
];

// ─── Epistemic phrases ─────────────────────────────────────────────────────
// First-person knowledge stance. Tells you whether a writer plants a flag
// or stays off-stage.
export const SIG_EPISTEMICS: SignatureTic[] = [
  { label: 'I think',     pattern: /\bI think\b/g,      category: 'epistemic' },
  { label: 'I believe',   pattern: /\bI believe\b/g,    category: 'epistemic' },
  { label: 'I mean',      pattern: /\bI mean\b/g,       category: 'epistemic' },
  { label: 'I guess',     pattern: /\bI guess\b/g,      category: 'epistemic' },
  { label: "I'd say",     pattern: /\bI'?d say\b/g,     category: 'epistemic' },
  { label: 'I know',      pattern: /\bI know\b/g,       category: 'epistemic' },
  { label: 'I suspect',   pattern: /\bI suspect\b/g,    category: 'epistemic' },
  { label: 'I realized',  pattern: /\bI realized\b/g,   category: 'epistemic' },
];

// ─── Frequency adverbs ─────────────────────────────────────────────────────
export const SIG_FREQUENCY: SignatureTic[] = [
  { label: 'always',      pattern: /\balways\b/gi,      category: 'frequency' },
  { label: 'never',       pattern: /\bnever\b/gi,       category: 'frequency' },
  { label: 'often',       pattern: /\boften\b/gi,       category: 'frequency' },
  { label: 'constantly',  pattern: /\bconstantly\b/gi,  category: 'frequency' },
  { label: 'rarely',      pattern: /\brarely\b/gi,      category: 'frequency' },
  { label: 'occasionally',pattern: /\boccasionally\b/gi,category: 'frequency' },
];

// ─── Attitude markers ──────────────────────────────────────────────────────
export const SIG_ATTITUDE: SignatureTic[] = [
  { label: 'unfortunately', pattern: /\bunfortunately\b/gi, category: 'attitude' },
  { label: 'fortunately',   pattern: /\bfortunately\b/gi,   category: 'attitude' },
  { label: 'thankfully',    pattern: /\bthankfully\b/gi,    category: 'attitude' },
  { label: 'curiously',     pattern: /\bcuriously\b/gi,     category: 'attitude' },
  { label: 'interestingly', pattern: /\binterestingly\b/gi, category: 'attitude' },
  { label: 'surprisingly',  pattern: /\bsurprisingly\b/gi,  category: 'attitude' },
  { label: 'predictably',   pattern: /\bpredictably\b/gi,   category: 'attitude' },
];

export const SIGNATURE_TICS: SignatureTic[] = [
  ...SIG_INTENSIFIERS,
  ...SIG_HEDGES,
  ...SIG_EMPHATICS,
  ...SIG_DISCOURSE,
  ...SIG_EPISTEMICS,
  ...SIG_FREQUENCY,
  ...SIG_ATTITUDE,
];
