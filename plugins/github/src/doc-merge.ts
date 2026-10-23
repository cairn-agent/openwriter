/**
 * Merging two devices' versions of the same document, paragraph by paragraph
 * (markdown paragraphs are lines). Where both changed the same paragraph, the
 * version edited most recently wins, by edit time, not by who sent it first.
 * Every replaced paragraph is reported so the writer whose words were replaced
 * sees a notice with Undo. Pure functions: git-sync.ts supplies the texts, the
 * three-way hunks and each line's edit time. adr: adr/two-way-sync.md
 */

/** When and where a line was last edited (from git blame of that side). */
export interface LineInfo { time: number; device: string; deviceId: string }

export interface Side {
  /** The line's last edit, when blame knows it. */
  line: (text: string) => LineInfo | undefined;
  /** The side's last change to the file: for removed lines, which have no blame. */
  fallback: LineInfo;
}

/** A paragraph one device's version replaced on another's. */
export interface Replacement {
  /** Lines now in the document (empty when the winning side removed the paragraph). */
  kept: string[];
  /** The other device's lines, which Undo puts back. */
  earlier: string[];
  /** The line before the change, so Undo can put back a removed paragraph. */
  anchor?: string;
  /** The device whose version won, and when it was edited (unix seconds). */
  device: string;
  time: number;
  /** The device whose version was replaced: it shows the notice. */
  loserId: string;
}

/** Marker size for `git merge-file`, long enough never to match prose. */
export const MARKER_SIZE = 31;

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitDoc(raw: string): { front: Record<string, any> | null; body: string } {
  const m = raw.match(FRONT);
  if (!m) return { front: null, body: raw };
  try { return { front: JSON.parse(m[1]), body: raw.slice(m[0].length) }; } catch { return { front: null, body: raw }; }
}

export function joinDoc(front: Record<string, any> | null, body: string): string {
  return front ? `---\n${JSON.stringify(front)}\n---\n${body}` : body;
}

/** Key by key: a key one side changed takes that side; a key both changed takes the newer side. */
export function mergeFront(base: Record<string, any> | null, ours: Record<string, any> | null, theirs: Record<string, any> | null, oursNewer: boolean): Record<string, any> | null {
  if (!ours || !theirs) return ours || theirs;
  const b = base || {};
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const out: Record<string, any> = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const o = ours[key];
    const t = theirs[key];
    const v = same(o, b[key]) ? t : same(t, b[key]) ? o : oursNewer ? o : t;
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function newest(lines: string[], side: Side): LineInfo {
  let best: LineInfo | undefined;
  for (const l of lines) {
    if (!l.trim()) continue;
    const info = side.line(l);
    if (info && (!best || info.time > best.time)) best = info;
  }
  return best || side.fallback;
}

/**
 * Settle the conflict hunks `git merge-file --diff3` left in `text`. A hunk
 * whose three versions have the same number of lines is settled line by line
 * (a line one side changed takes that side; a line both changed takes the
 * newer); any other hunk goes to the side edited most recently. Ties keep this
 * side's version.
 */
export function resolveHunks(text: string, ours: Side, theirs: Side): { text: string; replacements: Replacement[] } {
  const open = '<'.repeat(MARKER_SIZE);
  const mid = '|'.repeat(MARKER_SIZE);
  const sep = '='.repeat(MARKER_SIZE);
  const close = '>'.repeat(MARKER_SIZE);
  const lines = text.split('\n');
  const out: string[] = [];
  const replacements: Replacement[] = [];
  const lastLine = () => [...out].reverse().find((l) => l.trim());

  const choose = (o: string[], t: string[]) => {
    const on = newest(o, ours);
    const tn = newest(t, theirs);
    const oursWins = on.time >= tn.time;
    const [win, lose, winInfo, loseInfo] = oursWins ? [o, t, on, tn] : [t, o, tn, on];
    const nonBlank = (ls: string[]) => ls.filter((l) => l.trim());
    if (nonBlank(lose).length && nonBlank(lose).join('\n') !== nonBlank(win).join('\n')) {
      replacements.push({
        kept: nonBlank(win), earlier: nonBlank(lose), anchor: lastLine(),
        device: winInfo.device, time: winInfo.time, loserId: loseInfo.deviceId,
      });
    }
    out.push(...win);
  };

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(open)) { out.push(lines[i]); continue; }
    const o: string[] = []; const b: string[] = []; const t: string[] = [];
    let part = o;
    for (i++; i < lines.length && !lines[i].startsWith(close); i++) {
      if (lines[i].startsWith(mid)) part = b;
      else if (lines[i].startsWith(sep)) part = t;
      else part.push(lines[i]);
    }
    if (o.length === b.length && t.length === b.length) {
      for (let k = 0; k < b.length; k++) {
        if (o[k] === b[k] || o[k] === t[k]) out.push(t[k]);
        else if (t[k] === b[k]) out.push(o[k]);
        else choose([o[k]], [t[k]]);
      }
    } else {
      choose(o, t);
    }
  }
  return { text: out.join('\n'), replacements };
}

// ── Pending (suggested) changes ─────────────────────────────────────────────

function entriesOf(raw: string | null): { doc: Record<string, any>; byId: Map<string, any> } {
  let doc: Record<string, any> = {};
  try { if (raw) doc = JSON.parse(raw); } catch { /* unreadable: treat as empty */ }
  const byId = new Map<string, any>();
  for (const e of Array.isArray(doc.entries) ? doc.entries : []) if (e?.nodeId) byId.set(e.nodeId, e);
  return { doc, byId };
}

/**
 * Merge a document's pending-changes file entry by entry. An entry that was
 * there before and is gone on either side was decided there, and stays gone:
 * a decided change is never brought back. New entries from either side are
 * kept; an entry both sides changed takes the newer side. A missing file is a
 * file with no entries. Returns null when nothing is left to keep.
 */
export function mergePending(base: string | null, ours: string | null, theirs: string | null, oursNewer: boolean): string | null {
  const b = entriesOf(base); const o = entriesOf(ours); const t = entriesOf(theirs);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const entries: any[] = [];
  for (const id of new Set([...o.byId.keys(), ...t.byId.keys()])) {
    const inBase = b.byId.has(id);
    const oe = o.byId.get(id); const te = t.byId.get(id);
    if (inBase && (!oe || !te)) continue;
    if (oe && te) {
      const be = b.byId.get(id);
      entries.push(same(oe, be) ? te : same(te, be) ? oe : oursNewer ? oe : te);
    } else {
      entries.push(oe || te);
    }
  }
  const top = oursNewer ? { ...t.doc, ...o.doc } : { ...o.doc, ...t.doc };
  const { entries: _drop, ...rest } = top;
  if (entries.length === 0 && Object.keys(rest).every((k) => k === 'version')) return null;
  return `${JSON.stringify({ ...rest, entries }, null, 2)}\n`;
}

/** The plain text of a TipTap node. */
export function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return Array.isArray(node.content) ? node.content.map(nodeText).join('') : '';
}

/** A markdown line as plain text: no emphasis marks, link targets or block markers. */
export function plainLine(md: string): string {
  return md
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();
}
