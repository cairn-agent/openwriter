/**
 * Author's Voice enrichment prompts, copied from the search engine so a writer's voice corpus is
 * enriched exactly the way the search engine enriches its own: per chunk the GR5 prompt
 * (the search engine's node enrichment prompts, version v5), per document the doc
 * prompt (packages/core/src/doc-enrichment.ts, version v1). Both are Doc2Query write-side
 * vocabulary: words a reader might search with that the text itself does not contain. The
 * text stays untouched; enrichment only adds. The search engine runs them on Gemini Flash-Lite; here
 * they run on Haiku with the writer's own key. Keep them in step with the search engine.
 * adr: adr/authors-voice.md
 */

export const CHUNK_PROMPT_VERSION = 'gr5';
export const DOC_PROMPT_VERSION = 'doc-v1';

/** The search engine skips chunks shorter than this (MIN_WORDS) and never enriches headings. */
export const MIN_CHUNK_WORDS = 2;

/** The search engine caps the document prompt's joined chunks at this many characters. */
export const MAX_DOC_CONTEXT_CHARS = 14000;

export interface ChunkEnrichment { synonyms: string[]; concepts: string[]; questions: string[] }
export interface DocEnrichment { synonyms: string[]; concepts: string[]; themes: string[] }

export function buildChunkPrompt(content: string): string {
  return `This passage will be indexed for search. Produce vocabulary a reader might type to find it.

Produce three lists:

synonyms: 8-12 single-word alternatives. Words the passage does NOT contain that a reader might use instead of words it does contain. Modern register.

phrase_variants: 3-5 multi-word concept labels. The passage embodies named concepts, frameworks, or topics. Produce alternative LABELS for those concepts — short names, 2-5 words each. Not sentence paraphrases.

questions: 2-3 questions a reader might type to find this passage.

Output strict JSON, no fences:
{
  "synonyms":        [...],
  "phrase_variants": [...],
  "questions":       [...]
}

PASSAGE:
${content}`;
}

export function buildDocPrompt(chunks: string[]): string {
  let joined = chunks.join('\n───\n');
  if (joined.length > MAX_DOC_CONTEXT_CHARS) joined = joined.slice(0, MAX_DOC_CONTEXT_CHARS) + '\n[... document truncated]';
  return `You are reading a SINGLE document broken into chunks. The chunks below are
in document order, separated by ─── markers. Your job is to describe the
document's *vocabulary field*: the broader synonyms, concepts, and themes that
a search query about THIS DOCUMENT would naturally use even when those exact
words don't appear in any one chunk.

Output strict JSON, no prose, no fences:

{
  "synonyms":  [...10-15 single-word or short-phrase synonyms for the document's recurring concepts...],
  "concepts":  [...5-8 concrete situations, problems, or frames the document speaks to...],
  "themes":    [...3-5 modern-phrased high-level themes. Short noun phrases, NOT questions...]
}

Critical rules:
1. NOVEL VOCABULARY ONLY. If a word already appears verbatim in the chunks
   below, do NOT put it in synonyms.
2. Each item is a single word or ≤4-word phrase.
3. Scope is DOCUMENT-WIDE — pick vocab that bridges queries to the document
   as a whole, not to any one chunk.

═══════════════ DOCUMENT (chunks in order) ═══════════════
${joined}
══════════════════════════════════════════════════════════

JSON:`;
}

function jsonObject(raw: string): any | null {
  const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);

/** GR5 answers `phrase_variants`; the search engine stores them as concepts. */
export function parseChunkEnrichment(raw: string): ChunkEnrichment | null {
  const p = jsonObject(raw);
  if (!p) return null;
  return { synonyms: strings(p.synonyms), concepts: strings(p.concepts ?? p.phrase_variants), questions: strings(p.questions) };
}

export function parseDocEnrichment(raw: string): DocEnrichment | null {
  const p = jsonObject(raw);
  if (!p) return null;
  return { synonyms: strings(p.synonyms), concepts: strings(p.concepts), themes: strings(p.themes) };
}

/** The searchable text the search engine indexes for an enrichment: every list, space-joined. */
export function searchable(e: ChunkEnrichment | DocEnrichment): string {
  return Object.values(e).flat().join(' ').trim();
}
