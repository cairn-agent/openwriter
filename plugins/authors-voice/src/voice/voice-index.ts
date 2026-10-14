/**
 * The writer's voice index: one SQLite file (<profile>/voice/index.db) for every document the
 * writer added to Author's Voice, keyed by OpenWriter's own document and paragraph ids.
 *
 * Search terms only: the full-text table is contentless (it keeps the words to match, never the
 * text), so the writer's .md files stay the one copy of their writing. What the index keeps per
 * paragraph is where it is (doc, paragraph id, heading path), a hash of its text, and the search engine's
 * enrichment of it, and who wrote it (Author's Voice's authenticity tag). Searching ranks four
 * fields as the search engine's queryStore does: the text, its headings, the paragraph's enrichment and the
 * document's enrichment. adr: adr/authors-voice.md
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { ChunkEnrichment, DocEnrichment } from './voice-prompts.js';

/** Author's Voice's authenticity tags: only Human text carries voice at full weight. */
export type Authenticity = 'Human' | 'AI-Assisted' | 'AI' | 'Untagged';

export interface VoiceChunk {
  nodeId: string;
  position: number;
  type: string;
  headingPath: string[];
  text: string;
  hash: string;
  authenticity?: Authenticity;
}

/** One paragraph a search sub-query matched, with its lexical rank in [0, 1). */
export interface VoiceHit {
  id: number;
  docId: string;
  nodeId: string;
  position: number;
  authenticity: string;
  rank: number;
}

/**
 * The search engine queryStore's field weights (TS_RANK_A/B/C/D): text 1.0, headings 0.4, paragraph
 * enrichment 0.3. The document's enrichment is 0 there because its word-graph expansion does the
 * bridging; this index has no word graph, and the search engine's note for that case is to raise it as the
 * fallback bridge.
 */
const W_CONTENT = 1.0;
const W_HEADING = 0.4;
const W_ENRICHMENT = 0.3;
const W_DOC_ENRICHMENT = 0.1;

export interface VoiceDocStatus {
  docId: string;
  title: string;
  addedAt: string;
  updatedAt: string;
  paragraphs: number;
  enriched: number;
  failed: number;
  docEnriched: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS voice_docs (
  doc_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  doc_hash TEXT,
  doc_prompt TEXT,
  doc_enrichment TEXT
);
CREATE TABLE IF NOT EXISTS voice_chunks (
  id INTEGER PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES voice_docs(doc_id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  prompt TEXT,
  enrichment TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  authenticity TEXT NOT NULL DEFAULT 'Human',
  UNIQUE (doc_id, node_id)
);
CREATE TABLE IF NOT EXISTS voice_meta (key TEXT PRIMARY KEY, value TEXT);
`;

/** English stemming, as the search engine's Postgres search does ('english' text search config). */
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS voice_fts USING fts5(
  content, heading, enrichment, doc_enrichment,
  content='', contentless_delete=1, tokenize='porter unicode61'
);
`;

export class VoiceIndex {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    const cols = (this.db.prepare('PRAGMA table_info(voice_chunks)').all() as any[]).map((c) => c.name);
    if (!cols.includes('authenticity')) this.db.exec(`ALTER TABLE voice_chunks ADD COLUMN authenticity TEXT NOT NULL DEFAULT 'Human'`);
    // An index made before stemming: its search rows are rebuilt from the documents (no Haiku).
    const fts = this.db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'voice_fts'`).get() as any;
    if (fts && !/porter/.test(String(fts.sql))) {
      this.db.exec('DROP TABLE voice_fts');
      this.db.prepare(`INSERT OR REPLACE INTO voice_meta (key, value) VALUES ('fts_rebuild', '1')`).run();
    }
    this.db.exec(FTS_SCHEMA);
  }

  close(): void { this.db.close(); }

  /** Documents whose search rows must be rebuilt from their text (after a tokenizer change). */
  needsRebuild(): boolean {
    return !!this.db.prepare(`SELECT 1 FROM voice_meta WHERE key = 'fts_rebuild'`).get();
  }

  rebuildDone(): void {
    this.db.prepare(`DELETE FROM voice_meta WHERE key = 'fts_rebuild'`).run();
  }

  /** Changes whenever a document is added, updated or re-enriched. */
  version(): string {
    const r = this.db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM voice_docs').get() as any;
    return `${r.n}:${r.t ?? ''}`;
  }

  docIds(): string[] {
    return (this.db.prepare('SELECT doc_id FROM voice_docs ORDER BY added_at').all() as any[]).map((r) => r.doc_id);
  }

  /** Add the document, or touch it if it is already in. */
  upsertDoc(docId: string, title: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO voice_docs (doc_id, title, added_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (doc_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
    `).run(docId, title, now, now);
  }

  /**
   * Make the stored paragraphs match the document now. Paragraphs that are gone are dropped;
   * one whose text (hash) or prompt version changed, or that failed, needs enriching again.
   * Returns the paragraphs to send to Haiku.
   */
  syncChunks(docId: string, chunks: VoiceChunk[], prompt: string): VoiceChunk[] {
    const stored = new Map<string, { id: number; hash: string; prompt: string | null; status: string }>();
    for (const r of this.db.prepare('SELECT id, node_id, content_hash, prompt, status FROM voice_chunks WHERE doc_id = ?').all(docId) as any[]) {
      stored.set(r.node_id, { id: r.id, hash: r.content_hash, prompt: r.prompt, status: r.status });
    }
    const keep = new Set(chunks.map((c) => c.nodeId));
    const del = this.db.prepare('DELETE FROM voice_chunks WHERE id = ?');
    const delFts = this.db.prepare('DELETE FROM voice_fts WHERE rowid = ?');
    for (const [nodeId, row] of stored) if (!keep.has(nodeId)) { delFts.run(row.id); del.run(row.id); }

    const upsert = this.db.prepare(`
      INSERT INTO voice_chunks (doc_id, node_id, position, block_type, heading_path, content_hash, authenticity) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (doc_id, node_id) DO UPDATE SET position = excluded.position, block_type = excluded.block_type,
        heading_path = excluded.heading_path, content_hash = excluded.content_hash, authenticity = excluded.authenticity
    `);
    const reset = this.db.prepare(`UPDATE voice_chunks SET status = 'pending', enrichment = NULL, prompt = NULL, error = NULL WHERE doc_id = ? AND node_id = ?`);
    const todo: VoiceChunk[] = [];
    for (const c of chunks) {
      const was = stored.get(c.nodeId);
      upsert.run(docId, c.nodeId, c.position, c.type, JSON.stringify(c.headingPath), c.hash, c.authenticity ?? 'Human');
      if (!was || was.hash !== c.hash || was.prompt !== prompt || was.status !== 'done') {
        reset.run(docId, c.nodeId);
        todo.push(c);
      }
    }
    return todo;
  }

  setChunkEnrichment(docId: string, nodeId: string, prompt: string, enrichment: ChunkEnrichment): void {
    this.db.prepare(`UPDATE voice_chunks SET status = 'done', prompt = ?, enrichment = ?, error = NULL WHERE doc_id = ? AND node_id = ?`)
      .run(prompt, JSON.stringify(enrichment), docId, nodeId);
  }

  setChunkFailed(docId: string, nodeId: string, error: string): void {
    this.db.prepare(`UPDATE voice_chunks SET status = 'failed', error = ? WHERE doc_id = ? AND node_id = ?`).run(error.slice(0, 300), docId, nodeId);
  }

  docEnrichmentFor(docId: string): { hash: string | null; prompt: string | null } {
    const r = this.db.prepare('SELECT doc_hash, doc_prompt FROM voice_docs WHERE doc_id = ?').get(docId) as any;
    return { hash: r?.doc_hash ?? null, prompt: r?.doc_prompt ?? null };
  }

  setDocEnrichment(docId: string, hash: string, prompt: string, enrichment: DocEnrichment): void {
    this.db.prepare('UPDATE voice_docs SET doc_hash = ?, doc_prompt = ?, doc_enrichment = ?, updated_at = ? WHERE doc_id = ?')
      .run(hash, prompt, JSON.stringify(enrichment), new Date().toISOString(), docId);
  }

  /**
   * Write the document's search rows from the paragraphs in hand: the text and headings are
   * matched but never stored (contentless), the enrichments come from this index.
   */
  reindexDoc(docId: string, chunks: VoiceChunk[], searchableOf: (json: string | null) => string): void {
    const doc = this.db.prepare('SELECT doc_enrichment FROM voice_docs WHERE doc_id = ?').get(docId) as any;
    const docText = searchableOf(doc?.doc_enrichment ?? null);
    const rows = new Map<string, { id: number; enrichment: string | null }>();
    for (const r of this.db.prepare('SELECT id, node_id, enrichment FROM voice_chunks WHERE doc_id = ?').all(docId) as any[]) rows.set(r.node_id, r);
    const delFts = this.db.prepare('DELETE FROM voice_fts WHERE rowid = ?');
    const ins = this.db.prepare('INSERT INTO voice_fts (rowid, content, heading, enrichment, doc_enrichment) VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const c of chunks) {
        const row = rows.get(c.nodeId);
        if (!row) continue;
        delFts.run(row.id);
        ins.run(row.id, c.text, c.headingPath.join(' '), searchableOf(row.enrichment), docText);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * One search sub-query: a quoted phrase ("onion skins") or a single keyword. Returns its top
   * paragraphs, best first, with a rank in [0, 1): FTS5's bm25 over the weighted fields, scaled the
   * way the search engine's ts_rank_cd normalization 32 scales (rank / (rank + 1)).
   */
  searchSub(q: string, topK: number): VoiceHit[] {
    const words = q.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    if (!words.length) return [];
    const match = `"${words.join(' ').replace(/"/g, '')}"`;
    return (this.db.prepare(`
      SELECT c.id AS id, c.doc_id AS docId, c.node_id AS nodeId, c.position AS position, c.authenticity AS authenticity,
        bm25(voice_fts, ${W_CONTENT}, ${W_HEADING}, ${W_ENRICHMENT}, ${W_DOC_ENRICHMENT}) AS score
      FROM voice_fts JOIN voice_chunks c ON c.id = voice_fts.rowid
      WHERE voice_fts MATCH ? ORDER BY score, c.id LIMIT ?
    `).all(match, topK) as any[]).map((r) => {
      const raw = Math.max(0, -Number(r.score));
      return { id: r.id, docId: r.docId, nodeId: r.nodeId, position: r.position, authenticity: r.authenticity, rank: raw / (raw + 1) };
    });
  }

  /** Paragraphs matching any word of a query, best first (tests and debugging). */
  search(query: string, limit = 10): Array<{ docId: string; nodeId: string; score: number }> {
    const terms = query.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((t) => t.length > 1) ?? [];
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    return (this.db.prepare(`
      SELECT c.doc_id AS docId, c.node_id AS nodeId,
        bm25(voice_fts, ${W_CONTENT}, ${W_HEADING}, ${W_ENRICHMENT}, ${W_DOC_ENRICHMENT}) AS score
      FROM voice_fts JOIN voice_chunks c ON c.id = voice_fts.rowid
      WHERE voice_fts MATCH ? ORDER BY score LIMIT ?
    `).all(match, limit) as any[]).map((r) => ({ docId: r.docId, nodeId: r.nodeId, score: -r.score }));
  }

  status(): VoiceDocStatus[] {
    return (this.db.prepare(`
      SELECT d.doc_id, d.title, d.added_at, d.updated_at, d.doc_enrichment IS NOT NULL AS doc_enriched,
        COUNT(c.id) AS paragraphs,
        SUM(CASE WHEN c.status = 'done' THEN 1 ELSE 0 END) AS enriched,
        SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM voice_docs d LEFT JOIN voice_chunks c ON c.doc_id = d.doc_id
      GROUP BY d.doc_id ORDER BY d.added_at
    `).all() as any[]).map((r) => ({
      docId: r.doc_id, title: r.title, addedAt: r.added_at, updatedAt: r.updated_at,
      paragraphs: Number(r.paragraphs), enriched: Number(r.enriched ?? 0), failed: Number(r.failed ?? 0), docEnriched: !!r.doc_enriched,
    }));
  }

  /** The stored enrichment for one paragraph (tests and debugging). */
  chunk(docId: string, nodeId: string): { status: string; enrichment: ChunkEnrichment | null; headingPath: string[]; authenticity: string } | null {
    const r = this.db.prepare('SELECT status, enrichment, heading_path, authenticity FROM voice_chunks WHERE doc_id = ? AND node_id = ?').get(docId, nodeId) as any;
    return r ? { status: r.status, enrichment: r.enrichment ? JSON.parse(r.enrichment) : null, headingPath: JSON.parse(r.heading_path), authenticity: r.authenticity } : null;
  }
}

const open = new Map<string, VoiceIndex>();

/** The index in this profile's folder, opened once. */
export function voiceIndex(dataDir: string): VoiceIndex {
  const dir = join(dataDir, 'voice');
  let idx = open.get(dir);
  if (!idx) {
    mkdirSync(dir, { recursive: true });
    idx = new VoiceIndex(join(dir, 'index.db'));
    open.set(dir, idx);
  }
  return idx;
}
