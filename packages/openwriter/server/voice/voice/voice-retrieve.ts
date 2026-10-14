/**
 * Voice examples for a rewrite: Author's Voice's retrieval, run on the writer's local voice index.
 *
 * Ported as is, only the storage underneath changed (Postgres -> the SQLite index):
 *   - Author's Voice's core retrieval adapter (coreRetrieve, the engine Author's
 *     Voice ran in production, VOICE_RETRIEVAL_ENGINE=core): a wide pool of 40, the dual-RAG
 *     exclusion, one paragraph per document, the word caps, the match quality.
 *   - The search engine's store (StoreService.queryStore, which coreRetrieve calls):
 *     the query split into phrases and keywords, 50 hits per sub-query, RRF fusion weighted by
 *     each hit's lexical rank, the adjacency boost, the soft penalty on text the writer did not
 *     write, and node-dedup's adjacent and overlap dedup. Off-by-default knobs stay off.
 *   - The search engine's text utilities and fusion: the stopwords, the phrase and keyword
 *     extraction, the fusion increment.
 * Not ported: queryStore's word-graph query expansion. It needs a thesaurus grown from a large
 * enrichment corpus, which a writer's index does not have; the index raises the document
 * enrichment's weight instead, as the search engine advises for a store without one (voice-index.ts).
 *
 * The index never stores the writing, so each candidate's text is read from its document,
 * once per document, and only for the candidates the selection reaches.
 * adr: adr/authors-voice.md
 */

import { voiceIndex, type VoiceHit } from './voice-index.js';
import { readParagraphs, rebuildVoiceSearch } from './voice-enrich.js';
import { dataDir } from '../host.js';

// ─── Retrieval types (Author's Voice) ─────────────────────────────

export interface ScoringConfig {
  phraseBoost: number;
  aiPenalty: number;
  maxChunks: number;
  deduplicateByDocument: boolean;
  maxTotalWords: number;
  maxPerClusterWords: number;
}

export interface GrepRAGResult {
  examples: Array<{
    anchor: string;
    context: string;
    wordCount: number;
    documentId: string;
    authenticity: string;
    rrfScore: number;
  }>;
  selectedChunkIds: string[];
  totalWords: number;
  totalExamples: number;
  matchQuality: 'strong' | 'moderate' | 'weak';
  retrieval: {
    round1Candidates: number;
    round2Candidates: number;
    finalSelected: number;
    phraseMatches: number;
    topRrfScore: number;
    timeMs: number;
    estimatedCost: number;
  };
}

/** Author's Voice's scoring presets */
export const RETRIEVE_SCORING: ScoringConfig = {
  phraseBoost: 1.5,
  aiPenalty: 0.7,
  maxChunks: 10,
  deduplicateByDocument: true,
  maxTotalWords: 1500,
  maxPerClusterWords: 300,
};

// ─── Search engine: text utilities ─────────────────────────────────────────────────

export const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your',
  'his','its','our','their','mine','yours','hers','ours','theirs','this','that',
  'these','those','who','whom','which','what','whose','where','when','how','why',
  'if','then','else','so','but','and','or','nor','not','no','yes','of','in','to',
  'for','with','on','at','by','from','up','about','into','through','during',
  'before','after','above','below','between','out','off','over','under','again',
  'further','once','here','there','all','each','every','both','few','more','most',
  'other','some','such','only','own','same','than','too','very','just','because',
  'as','until','while','also','back','even','still','way','well','now','get',
  'got','like','make','go','going','come','take','know','think','see','look',
  'want','give','use','find','tell','ask','seem','feel','try','leave','call',
  'need','let','keep','say','said','put','thing','things','man','men','one',
]);

export function extractKeywordsDeterministic(text: string): string[] {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z\s'-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  )];
}

/** Extract 2-3 word phrases via sliding window over non-stopword sequences. Cap at 5. */
export function extractPhrasesDeterministic(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Build runs of consecutive non-stopwords
  const runs: string[][] = [];
  let current: string[] = [];
  for (const w of words) {
    if (!STOPWORDS.has(w)) {
      current.push(w);
    } else {
      if (current.length >= 2) runs.push(current);
      current = [];
    }
  }
  if (current.length >= 2) runs.push(current);

  // Generate bigrams and trigrams from each run
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (let n = 3; n >= 2; n--) {
      for (let i = 0; i <= run.length - n; i++) {
        const phrase = run.slice(i, i + n).join(' ');
        if (!seen.has(phrase)) {
          seen.add(phrase);
          phrases.push(phrase);
        }
      }
    }
  }

  return phrases.slice(0, 5);
}

// ─── Search engine: decomposeRawQuery ───────────────────────────────────

// Per-sub-query RRF weights. Equal-weight matches the empirical sweet spot
// on the author's voice corpus (1.5/2.0 split made no measurable difference).
const PHRASE_RRF_WEIGHT = 1.0;
const KEYWORD_RRF_WEIGHT = 1.0;

type WeightedSubQuery = { q: string; weight: number };

export function decomposeRawQuery(queryText: string): WeightedSubQuery[] {
  const hasOperators = /\bOR\b|"[^"]+"|\s-\w/.test(queryText);
  if (hasOperators) return [{ q: queryText, weight: KEYWORD_RRF_WEIGHT }];

  const phrases = extractPhrasesDeterministic(queryText);    // 2-3 word n-grams, cap 5
  const keywords = extractKeywordsDeterministic(queryText);  // single non-stopword tokens

  if (phrases.length === 0 && keywords.length === 0) {
    return [{ q: queryText, weight: KEYWORD_RRF_WEIGHT }];
  }

  const phraseQs: WeightedSubQuery[] = phrases.map(p => ({ q: `"${p}"`, weight: PHRASE_RRF_WEIGHT }));
  const kwQs: WeightedSubQuery[] = keywords.map(k => ({ q: k, weight: KEYWORD_RRF_WEIGHT }));

  const subs = [...phraseQs, ...kwQs];
  return subs.length > 0 ? subs : [{ q: queryText, weight: KEYWORD_RRF_WEIGHT }];
}

// ─── Search engine: fusion ────────────────────────────────────────────────────────

const RRF_K = 60;
const RRF_TSRANK_W = 1;

export function rrfIncrement(tsRank: number, rankSlot: number, opts: { weight?: number; k?: number; tsRankW?: number } = {}): number {
  const weight = opts.weight ?? 1;
  const k = opts.k ?? RRF_K;
  const tsRankW = opts.tsRankW ?? 1;
  const ts = Number.isFinite(tsRank) ? tsRank : 0;
  return (weight * (1 + tsRankW * ts)) / (k + rankSlot);
}

// ─── Search engine: queryStore (the parts on by default) ────────────────

const DEFAULT_TOP_K_PER_QUERY = 50;
const DEFAULT_ADJACENCY_WINDOW = 3;
const DEFAULT_ADJACENCY_ALPHA = 0.3;
const AI_PENALTY_DEFAULT = 0.7;
/** coreRetrieve's pool: "Wide pool -> filters -> dedup-by-doc (voice wants diverse anchors)." */
const CORE_POOL_LIMIT = 40;

type Fused = VoiceHit & { fused: number; boostedRank: number };

/**
 * Adjacency boost, grouped by document: the search engine groups by store, and a paragraph's position is
 * counted within its own document here.
 */
function applyAdjacencyBoost(hits: Array<VoiceHit & { fused: number }>, window: number, alpha: number): Fused[] {
  if (window <= 0 || alpha <= 0) return hits.map(h => ({ ...h, boostedRank: h.fused }));
  const byDoc = new Map<string, Array<VoiceHit & { fused: number }>>();
  for (const h of hits) {
    if (!byDoc.has(h.docId)) byDoc.set(h.docId, []);
    byDoc.get(h.docId)!.push(h);
  }
  const enriched = new Map<number, number>();
  for (const [, docHits] of byDoc) {
    for (const hit of docHits) {
      let boost = 0;
      for (const other of docHits) {
        if (other.id === hit.id) continue;
        const dist = Math.abs(hit.position - other.position);
        if (dist <= window) boost += alpha * other.fused * (1 - dist / (window + 1));
      }
      enriched.set(hit.id, hit.fused + boost);
    }
  }
  return hits.map(h => ({ ...h, boostedRank: enriched.get(h.id) ?? h.fused }));
}

// ─── Search engine: dedup ─────────────────────────────────────────────────

const DEFAULT_ADJACENT_WINDOW = 1;     // immediate neighbors
const DEFAULT_OVERLAP_THRESHOLD = 0.6;  // 60% word overlap

function wordSet(content: string): Set<string> {
  return new Set(
    content
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size < b.size ? [a, b] : [b, a];
  for (const w of smaller) {
    if (larger.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Text of a candidate, read from its document ────────────────────────────────

/** Paragraph texts per document for one retrieval: each document read at most once. */
class TextCache {
  private docs = new Map<string, Map<string, string> | null>();

  async text(docId: string, nodeId: string): Promise<string | null> {
    if (!this.docs.has(docId)) {
      try {
        const { chunks } = await readParagraphs(docId);
        this.docs.set(docId, new Map(chunks.map((c) => [c.nodeId, c.text])));
      } catch {
        this.docs.set(docId, null);
      }
    }
    return this.docs.get(docId)?.get(nodeId) ?? null;
  }
}

/** A selected candidate with its text. */
type Picked = Fused & { content: string; wordCount: number };

/**
 * queryStore for one store: decompose, search each sub-query, fuse, boost, penalise, dedup, and
 * return the top `limit`. The dedup walks the score order and stops at `limit`, so a candidate's
 * text is read only if the walk reaches it; the result equals dedup-then-slice.
 */
async function queryStore(query: string, limit: number, aiPenalty: number, texts: TextCache): Promise<{ nodes: Picked[]; pool: number }> {
  const idx = voiceIndex(dataDir());
  const subqueries = decomposeRawQuery(query.trim());
  const perQuery = subqueries.map((s) => idx.searchSub(s.q, DEFAULT_TOP_K_PER_QUERY));

  const scores = new Map<number, number>();
  const hitById = new Map<number, VoiceHit>();
  perQuery.forEach((list, qi) => {
    const w = subqueries[qi].weight;
    list.forEach((hit, i) => {
      const inc = rrfIncrement(hit.rank, i + 1, { weight: w, k: RRF_K, tsRankW: RRF_TSRANK_W });
      scores.set(hit.id, (scores.get(hit.id) || 0) + inc);
      if (!hitById.has(hit.id)) hitById.set(hit.id, hit);
    });
  });
  const fused = [...scores.entries()].map(([id, s]) => ({ ...hitById.get(id)!, fused: s }));

  let boosted = applyAdjacencyBoost(fused, DEFAULT_ADJACENCY_WINDOW, DEFAULT_ADJACENCY_ALPHA);
  // Human-preference: 'Human' passes untouched; everything else is x aiPenalty.
  boosted = boosted.map(x => (x.authenticity === 'Human' ? x : { ...x, boostedRank: x.boostedRank * aiPenalty }));
  boosted.sort((a, b) => b.boostedRank - a.boostedRank);

  const selected: Picked[] = [];
  const selectedSets: Set<string>[] = [];
  for (const cand of boosted) {
    if (selected.length >= limit) break;
    if (selected.some((sel) => sel.docId === cand.docId && Math.abs(sel.position - cand.position) <= DEFAULT_ADJACENT_WINDOW)) continue;
    const content = await texts.text(cand.docId, cand.nodeId);
    if (content === null) continue; // gone from its document since it was added
    const candSet = wordSet(content);
    if (selectedSets.some((s) => jaccard(candSet, s) >= DEFAULT_OVERLAP_THRESHOLD)) continue;
    selected.push({ ...cand, content, wordCount: content.split(/\s+/).filter(Boolean).length });
    selectedSets.push(candSet);
  }
  return { nodes: selected, pool: boosted.length };
}

// ─── Author's Voice's core retrieval adapter (coreRetrieve) ──────────────────────

type Example = GrepRAGResult['examples'][number];

function truncateExample(ex: Example, maxWords: number): Example {
  const words = ex.context.split(/\s+/);
  if (words.length <= maxWords) return ex;
  const anchorWords = ex.anchor.split(/\s+/);
  const anchorStart = words.findIndex((_, i) =>
    i + anchorWords.length <= words.length &&
    words.slice(i, i + anchorWords.length).join(' ') === anchorWords.join(' ')
  );
  let start: number, end: number;
  if (anchorStart === -1) {
    const center = Math.floor(words.length / 2);
    start = Math.max(0, center - Math.floor(maxWords / 2));
    end = Math.min(words.length, start + maxWords);
    start = Math.max(0, end - maxWords);
  } else {
    start = anchorStart;
    end = Math.min(words.length, anchorStart + anchorWords.length);
    while (end - start < maxWords) {
      const grew = end - start;
      if (end < words.length) end++;
      if (end - start < maxWords && start > 0) start--;
      if (end - start === grew) break;
    }
  }
  const sliced = words.slice(start, end);
  return { ...ex, context: sliced.join(' '), wordCount: sliced.length };
}

function applyWordCaps(examples: Example[], scoring: ScoringConfig): Example[] {
  const capped: Example[] = [];
  let total = 0;
  for (const example of examples) {
    let ex = example;
    if (ex.wordCount > scoring.maxPerClusterWords) ex = truncateExample(ex, scoring.maxPerClusterWords);
    if (total + ex.wordCount > scoring.maxTotalWords) {
      const remaining = scoring.maxTotalWords - total;
      if (remaining > 30) { capped.push(truncateExample(ex, remaining)); total += remaining; }
      break;
    }
    capped.push(ex);
    total += ex.wordCount;
  }
  return capped;
}

// matchQuality is display-only (never gates behavior). Calibrated to core's
// score scale (≈0.02–0.08), not the fork's RRF scale.
function assessMatchQuality(topScore: number, returned: number): 'strong' | 'moderate' | 'weak' {
  if (returned >= 3 && topScore >= 0.05) return 'strong';
  if (returned >= 1 && topScore >= 0.025) return 'moderate';
  return 'weak';
}

export function emptyRagResult(timeMs = 0): GrepRAGResult {
  return {
    examples: [], selectedChunkIds: [], totalWords: 0, totalExamples: 0, matchQuality: 'weak',
    retrieval: { round1Candidates: 0, round2Candidates: 0, finalSelected: 0, phraseMatches: 0, topRrfScore: 0, timeMs, estimatedCost: 0 },
  };
}

/** A paragraph's id across the index: "<docId>:<nodeId>". */
export const chunkKey = (docId: string, nodeId: string) => `${docId}:${nodeId}`;

/**
 * Drop-in for GrepRAGService.retrieve: the writer's voice examples for a query. `excludeChunkIds`
 * holds chunk keys (the system prompt's examples, and the paragraphs being rewritten).
 */
export async function retrieveVoice(
  paragraph: string,
  options: { excludeChunkIds?: string[]; scoring?: ScoringConfig } = {},
): Promise<GrepRAGResult> {
  const scoring = options.scoring ?? RETRIEVE_SCORING;
  const start = Date.now();
  await rebuildVoiceSearch();
  const texts = new TextCache();

  // The exclusion is applied before the pool is cut (coreRetrieve filters the 40 after); it
  // only skips paragraphs, so the others keep their order.
  const ex = new Set(options.excludeChunkIds || []);
  const res = await queryStore(paragraph, CORE_POOL_LIMIT + ex.size, scoring.aiPenalty ?? AI_PENALTY_DEFAULT, texts);
  const nodes = res.nodes.filter((n) => !ex.has(chunkKey(n.docId, n.nodeId))).slice(0, CORE_POOL_LIMIT);

  // Dedup by source document.
  const seen = new Set<string>();
  const picked: Picked[] = [];
  for (const n of nodes) {
    if (seen.has(n.docId)) continue;
    seen.add(n.docId);
    picked.push(n);
    if (picked.length >= scoring.maxChunks) break;
  }
  if (picked.length === 0) return emptyRagResult(Date.now() - start);

  const topScore = picked[0]?.boostedRank ?? 0;
  let examples: Example[] = picked.map(n => ({
    anchor: n.content, context: n.content, wordCount: n.wordCount,
    documentId: n.docId, authenticity: n.authenticity, rrfScore: n.boostedRank,
  }));
  examples = applyWordCaps(examples, scoring);

  return {
    examples,
    selectedChunkIds: picked.map(n => chunkKey(n.docId, n.nodeId)),
    totalWords: examples.reduce((s, e) => s + e.wordCount, 0),
    totalExamples: examples.length,
    matchQuality: assessMatchQuality(topScore, examples.length),
    retrieval: {
      round1Candidates: res.pool, round2Candidates: 0,
      finalSelected: examples.length, phraseMatches: 0,
      topRrfScore: topScore, timeMs: Date.now() - start, estimatedCost: 0,
    },
  };
}
