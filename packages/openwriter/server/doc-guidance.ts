/**
 * Format contracts for typed documents, delivered with the document. The first time an agent
 * session touches a document of a contracted type, the tool result carries the contract in full;
 * after that, a one-line reminder naming it. The contracts are the files in ./guidance, each with
 * a version in its frontmatter. adr: adr/in-system-guidance.md
 *
 * Node built-ins only: the client-mode MCP proxy imports GUIDANCE_NOTICE from here.
 */

import { readFileSync } from 'fs';

/** Which contracts each content_type receives, in reading order. */
const CONTRACTS: Record<string, string[]> = {
  tweet: ['tweet', 'x-post', 'thread'],
  reply: ['reply', 'x-post', 'thread'],
  quote: ['quote', 'x-post', 'thread'],
  article: ['article'],
};

/** For the MCP server instructions. */
export const GUIDANCE_NOTICE = 'X documents (content_type tweet, reply, quote, article) have format contracts. The first tool result in a session that touches one carries its contract in full, later ones a one-line reminder; the contract describes how that document is written.';

interface Contract { name: string; version: number; body: string }

const loaded = new Map<string, Contract>();

function contract(name: string): Contract {
  let c = loaded.get(name);
  if (!c) {
    const raw = readFileSync(new URL(`./guidance/${name}.md`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const m = /^---\nversion: (\d+)\n---\n/.exec(raw);
    if (!m) throw new Error(`guidance/${name}.md has no version frontmatter`);
    c = { name, version: Number(m[1]), body: raw.slice(m[0].length).trim() };
    loaded.set(name, c);
  }
  return c;
}

/** Contracts already sent in full, per agent session, as name@version. */
const delivered = new Map<string, Set<string>>();

/**
 * The guidance for one touch of a document by one agent session: the contracts not yet sent in
 * this session in full, or a one-line reminder when all were; null for a type without contracts.
 */
export function guidanceFor(session: string, docId: string, contentType: string | undefined): string | null {
  const names = contentType ? CONTRACTS[contentType] : undefined;
  if (!names) return null;
  const contracts = names.map(contract);
  let sent = delivered.get(session);
  if (!sent) delivered.set(session, sent = new Set());
  const fresh = contracts.filter((c) => !sent.has(`${c.name}@${c.version}`));
  for (const c of fresh) sent.add(`${c.name}@${c.version}`);
  const label = contracts.map((c) => `${c.name} v${c.version}`).join(', ');
  if (fresh.length === 0) {
    return `[OpenWriter: ${docId} is an X ${contentType}. Its format contract (${label}) arrived earlier in this session and applies.]`;
  }
  const earlier = contracts.filter((c) => !fresh.includes(c)).map((c) => `${c.name} v${c.version}`);
  const header = `[OpenWriter format contract for ${docId}, an X ${contentType}: ${label}.${earlier.length ? ` Sent earlier in this session: ${earlier.join(', ')}.` : ''}]`;
  return [header, ...fresh.map((c) => c.body)].join('\n\n');
}
