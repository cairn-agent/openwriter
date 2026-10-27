/**
 * Keep what the writer just typed when a GitHub pull brings a newer copy of
 * the open document. Pure and dependency-free so the browser applies it and
 * the sync test checks it. adr: adr/two-way-sync.md
 *
 * `base` is the document as the pull committed it, `mine` is what the
 * browser shows now, `theirs` is the merged copy. Blocks are top-level and
 * pair up across copies by id, else by the first unpaired block with the same
 * content (a file written without block ids gets new ones on load). A block
 * in `mine` that differs from its `base` pair, or has none, is the writer's:
 * it replaces its pair in `theirs`, or, when `theirs` has none, goes in after
 * the writer's previous block. A `base` block the writer removed is removed
 * from `theirs` unless `theirs` changed it. Every other block is `theirs`.
 * Returns null when the writer changed nothing since `base`, so the new copy
 * shows as it is.
 */

type Block = { attrs?: { id?: string | null } | null; [key: string]: unknown };
type Doc = { content?: Block[]; [key: string]: unknown };

/** A block as comparable text: nulls dropped and keys sorted, as the editor and server differ there. */
function key(block: unknown, withoutId = false): string {
  return JSON.stringify(block, (k, v) => v === null || (withoutId && k === 'id') ? undefined
    : v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k2) => [k2, v[k2]])) : v);
}

const idOf = (block: Block | null): string | undefined => block?.attrs?.id || undefined;

/** For each block of `from`, the index of its pair in `to` (or -1): same id first, then same content. */
function pairs(from: Block[], to: Array<Block | null>): number[] {
  const taken = new Set<number>();
  const out = from.map((b) => {
    const at = idOf(b) ? to.findIndex((t, i) => !taken.has(i) && idOf(t) === idOf(b)) : -1;
    if (at >= 0) taken.add(at);
    return at;
  });
  return out.map((at, n) => {
    if (at >= 0) return at;
    const same = to.findIndex((t, i) => !taken.has(i) && t !== null && key(t, true) === key(from[n], true));
    if (same >= 0) taken.add(same);
    return same;
  });
}

export function keepTypedBlocks(base: Doc, mine: Doc, theirs: Doc): Doc | null {
  const baseBlocks = base.content || [];
  const mineBlocks = mine.content || [];
  const mineToBase = pairs(mineBlocks, baseBlocks);
  const typed = mineBlocks.map((b, n) => mineToBase[n] < 0 || key(baseBlocks[mineToBase[n]], true) !== key(b, true));
  const kept = new Set(mineToBase.filter((at) => at >= 0));
  const removed = baseBlocks.map((_, i) => !kept.has(i));
  if (!typed.includes(true) && !removed.includes(true)) return null;

  const out: Array<Block | null> = [...(theirs.content || [])];
  const baseToTheirs = pairs(baseBlocks, out);
  baseBlocks.forEach((b, i) => {
    const at = baseToTheirs[i];
    if (removed[i] && at >= 0 && key(out[at], true) === key(b, true)) out[at] = null;
  });
  const after = new Map<number, Block[]>(); // blocks the new copy lacks, by the slot they follow (-1 = top)
  let previous = -1;
  mineBlocks.forEach((block, n) => {
    const at = mineToBase[n] >= 0 ? baseToTheirs[mineToBase[n]] : -1;
    if (typed[n]) {
      if (at >= 0) out[at] = block;
      else after.set(previous, [...(after.get(previous) || []), block]);
    }
    if (at >= 0) previous = at;
  });

  const content: Block[] = [...(after.get(-1) || [])];
  out.forEach((block, i) => {
    if (block) content.push(block);
    content.push(...(after.get(i) || []));
  });
  return { ...theirs, content };
}
