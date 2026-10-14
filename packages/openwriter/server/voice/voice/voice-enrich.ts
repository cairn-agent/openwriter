/**
 * Add a document to the writer's Author's Voice: read its paragraphs through OpenWriter
 * (read_pad, so the ids are OpenWriter's own), enrich each new or changed paragraph and the
 * document as a whole with the search engine's prompts on Haiku with the writer's key, then write the
 * search rows. Re-adding a document only sends the paragraphs whose text changed.
 * adr: adr/authors-voice.md
 */

import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { claude, dataDir, tools, VoiceError, type MessagesClient, explainApiError } from '../host.js';
import { createMessage, modelFor } from '../models.js';
import { recordUsage, tokenCounts } from '../usage-log.js';
import { voiceIndex, type Authenticity, type VoiceChunk } from './voice-index.js';
import {
  buildChunkPrompt, buildDocPrompt, parseChunkEnrichment, parseDocEnrichment, searchable,
  CHUNK_PROMPT_VERSION, DOC_PROMPT_VERSION, MIN_CHUNK_WORDS,
} from './voice-prompts.js';

/** Haiku calls at once. Enough to finish a long post in under a minute, low enough for new keys' rate limits. */
const CONCURRENCY = 4;

export { VoiceError };

export interface VoiceRunResult {
  docId: string;
  title: string;
  paragraphs: number;
  enriched: number;
  unchanged: number;
  failed: number;
  docEnriched: boolean;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Paragraphs from read_pad's tagged lines (`[p:abc12345] text`), with the heading path above
 * each. Headings and empty containers (lists, quotes, tables) are not paragraphs; their items
 * are. A line without a tag continues the line above (a hard break inside a paragraph).
 */
export function chunksFromCompact(compact: string): VoiceChunk[] {
  const lines = compact.split('\n');
  const start = lines.indexOf('---');
  const body = start >= 0 ? lines.slice(start + 1) : lines;
  const blocks: Array<{ type: string; id: string; text: string }> = [];
  for (const line of body) {
    // read_pad's own notes ("[FORCED FULL READ — 16 words ...]") are not writing; their counts
    // change with every edit and would make the last paragraph look changed each time.
    if (/^\[[A-Z][A-Z ]{3,}/.test(line)) continue;
    const m = /^\s*\[([a-z0-9]+):([^\]]+)\]\s?(.*)$/.exec(line);
    if (m) blocks.push({ type: m[1], id: m[2], text: m[3] });
    else if (blocks.length && line.trim()) blocks[blocks.length - 1].text += `\n${line.trim()}`;
  }
  // A document named by its first line repeats its title as that line; a title is not voice.
  // Compared by words only: the line often ends with a period the title does not have.
  const words_ = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const title = words_(/^title:\s*(.*)$/m.exec(compact)?.[1] ?? '');
  const firstText = blocks.findIndex((b) => b.text.trim());
  if (title && firstText >= 0 && words_(blocks[firstText].text) === title) blocks.splice(firstText, 1);
  const out: VoiceChunk[] = [];
  const path: string[] = [];
  for (const b of blocks) {
    const h = /^h([1-6])$/.exec(b.type);
    if (h) {
      path.length = Math.min(path.length, Number(h[1]) - 1);
      path[Number(h[1]) - 1] = b.text.trim();
      continue;
    }
    const text = b.text.trim();
    if (!text || words(text) < MIN_CHUNK_WORDS || /^_+$/.test(b.id)) continue;
    out.push({ nodeId: b.id, position: out.length, type: b.type, headingPath: path.filter(Boolean), text, hash: hash(text) });
  }
  return out;
}

/** A document as voice sees it: its title, its paragraphs, and its whole text (headings too). */
export async function readParagraphs(docId: string): Promise<{ title: string; chunks: VoiceChunk[]; text: string }> {
  const readPad = tools().find((t) => t.name === 'read_pad');
  if (!readPad) throw new VoiceError(500, 'failed', 'The editor is not ready.');
  const res: any = await readPad.handler({ docId, force: true });
  const compact = String(res?.content?.[0]?.text ?? '');
  if (res?.isError || /^Error/i.test(compact)) throw new VoiceError(404, 'not_found', 'That document could not be read.');
  const title = /^title:\s*(.*)$/m.exec(compact)?.[1]?.trim() || 'Untitled';
  const lines = compact.split('\n');
  const body = lines.slice(lines.indexOf('---') + 1).filter((l) => !/^\[[A-Z][A-Z ]{3,}/.test(l));
  const text = body.map((l) => l.replace(/^\s*\[[a-z0-9]+:[^\]]+\]\s?/, '').trim()).filter(Boolean).join('\n\n');
  return { title, chunks: chunksFromCompact(compact), text };
}

/**
 * Who wrote each paragraph, as Author's Voice tags it: OpenWriter's attribution says human, agent
 * or mixed per paragraph. Text from before attribution began (imported writing) counts as the
 * writer's own, as an upload did in Author's Voice.
 */
async function authenticityOf(docId: string): Promise<Record<string, Authenticity>> {
  const getAttribution = tools().find((t) => t.name === 'get_attribution');
  if (!getAttribution) return {};
  try {
    const res: any = await getAttribution.handler({ docId });
    const origins: Record<string, string> = JSON.parse(String(res?.content?.[0]?.text ?? '{}')).nodeOrigins ?? {};
    const tag = (o: string): Authenticity => (o === 'agent' ? 'AI' : o === 'mixed' ? 'AI-Assisted' : 'Human');
    return Object.fromEntries(Object.entries(origins).map(([id, o]) => [id, tag(o)]));
  } catch {
    return {};
  }
}

/**
 * Search rows for every added document, rebuilt from the documents' text after the index's word
 * handling changed. No Haiku: the enrichments are kept.
 */
export async function rebuildVoiceSearch(): Promise<void> {
  const idx = voiceIndex(dataDir());
  if (!idx.needsRebuild()) return;
  for (const docId of idx.docIds()) {
    try {
      const { chunks } = await readParagraphs(docId);
      idx.reindexDoc(docId, chunks, (json) => (json ? searchable(JSON.parse(json)) : ''));
    } catch { /* a document that cannot be read keeps no search rows until it is added again */ }
  }
  idx.rebuildDone();
}

async function haiku(client: MessagesClient, prompt: string, maxTokens: number, docId: string): Promise<string> {
  const model = await modelFor('haiku');
  const r = await createMessage(client, model, {
    max_tokens: maxTokens,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });
  recordUsage({ kind: 'voice-enrich', model: model.id, docId, ...tokenCounts(r.usage), toolCalls: 0, ok: r.stop_reason === 'end_turn' });
  return r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

const running = new Map<string, Promise<VoiceRunResult>>();

/** How many documents are being added now. */
export const voiceAddsRunning = () => running.size;

/** Add (or refresh) one document. A second call while one runs for the same doc joins it. */
export function addToVoice(docId: string): Promise<VoiceRunResult> {
  const live = running.get(docId);
  if (live) return live;
  const run = doAdd(docId).finally(() => running.delete(docId));
  running.set(docId, run);
  return run;
}

async function doAdd(docId: string): Promise<VoiceRunResult> {
  const client = claude({ job: 'learn' });
  const { title, chunks } = await readParagraphs(docId);
  if (!chunks.length) throw new VoiceError(400, 'empty', `"${title}" has no paragraphs to learn your voice from yet.`);
  const authors = await authenticityOf(docId);
  for (const c of chunks) c.authenticity = authors[c.nodeId] ?? 'Human';

  const idx = voiceIndex(dataDir());
  await rebuildVoiceSearch();
  idx.upsertDoc(docId, title);
  const todo = idx.syncChunks(docId, chunks, CHUNK_PROMPT_VERSION);

  let failed = 0;
  let keyRejected = false;
  let stopReason: VoiceError | null = null;
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let c = queue.shift(); c && !keyRejected; c = queue.shift()) {
      try {
        // Each paragraph names its words: Learn my voice is free for the first 10,000 on the balance.
        const parsed = parseChunkEnrichment(await haiku(claude({ job: 'learn', words: words(c.text) }), buildChunkPrompt(c.text), 800, docId));
        if (!parsed) throw new Error('unparseable enrichment');
        idx.setChunkEnrichment(docId, c.nodeId, CHUNK_PROMPT_VERSION, parsed);
      } catch (err: any) {
        failed++;
        // A rejected key, or an empty OpenWriter balance, stops the run: every paragraph would fail the same way.
        if (err instanceof Anthropic.AuthenticationError || explainApiError(err).status === 402) { keyRejected = true; stopReason = explainApiError(err); }
        idx.setChunkFailed(docId, c.nodeId, String(err?.message || err));
      }
    }
  }));
  const stop = stopReason as VoiceError | null; // set inside the workers above
  if (keyRejected) throw stop && stop.code !== 'key_rejected' ? stop : new VoiceError(401, 'key_rejected', "Anthropic did not accept your API key. Check it in Settings, under Claude.");

  // The document's own vocabulary, redone when any paragraph changed.
  const docHash = hash(chunks.map((c) => c.hash).join('|'));
  const prev = idx.docEnrichmentFor(docId);
  let docEnriched = prev.hash === docHash && prev.prompt === DOC_PROMPT_VERSION;
  if (!docEnriched) {
    try {
      const parsed = parseDocEnrichment(await haiku(client, buildDocPrompt(chunks.map((c) => c.text)), 1000, docId));
      if (parsed) { idx.setDocEnrichment(docId, docHash, DOC_PROMPT_VERSION, parsed); docEnriched = true; }
    } catch { /* the paragraphs still count; the next add retries the document */ }
  }

  idx.reindexDoc(docId, chunks, (json) => (json ? searchable(JSON.parse(json)) : ''));
  return { docId, title, paragraphs: chunks.length, enriched: todo.length - failed, unchanged: chunks.length - todo.length, failed, docEnriched };
}

/** What the writer reads when the run is done. */
export function voiceMessage(r: VoiceRunResult): string {
  const n = (k: number, one: string) => `${k.toLocaleString()} ${one}${k === 1 ? '' : 's'}`;
  if (!r.enriched && !r.failed) return `"${r.title}" is already in your voice and up to date (${n(r.paragraphs, 'paragraph')}).`;
  const head = r.unchanged
    ? `Updated "${r.title}" in your voice: ${n(r.enriched, 'changed paragraph')} enriched, ${r.unchanged.toLocaleString()} unchanged.`
    : `Added "${r.title}" to your voice: ${n(r.enriched, 'paragraph')} enriched.`;
  return r.failed ? `${head} ${n(r.failed, 'paragraph')} could not be enriched; add it again to retry.` : head;
}

/** The docId in a document's frontmatter, as OpenWriter stores it. */
export function docIdFromMarkdown(md: string): string | null {
  return /"docId"\s*:\s*"([^"]+)"/.exec(md)?.[1] ?? /^docId:\s*["']?([0-9a-f]{8})/m.exec(md)?.[1] ?? null;
}
