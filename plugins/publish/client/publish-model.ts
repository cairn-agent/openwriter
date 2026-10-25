/**
 * What publishing the open document needs on both layouts (the phone's sheet and the desktop's
 * Publish page): who an email would reach, and the doc's one "free up to here" marker.
 */

export interface Counts { active_by_tier?: Record<string, number>; emailed_by_tier?: Record<string, number>; email_off?: number }

/**
 * How many people an email to this audience reaches, from get_subscriber_counts: subscribers who
 * turned emails off are on the list but never emailed (emailed_by_tier leaves them out).
 */
export function recipients(counts: Counts | null, audience: 'everyone' | 'paid'): number | null {
  const t = counts?.emailed_by_tier ?? counts?.active_by_tier;
  if (!t) return null;
  if (audience === 'paid') return (t.paid || 0) + (t.founding || 0) + (t.comp || 0);
  return Object.values(t).reduce((a, b) => a + (b || 0), 0);
}

/** Top-level blocks with text, for the "free up to here" picker, and where the marker is now. */
export function wallChoices(editor: any): { blocks: Array<{ index: number; text: string }>; current: number | null } {
  const blocks: Array<{ index: number; text: string }> = [];
  let current: number | null = null;
  let i = 0;
  editor?.state.doc.forEach((node: any) => {
    if (node.type.name === 'horizontalRule' && node.attrs?.paywall) { current = blocks.length; return; }
    const text = node.textContent.trim();
    if (text) blocks.push({ index: i, text });
    i++;
  });
  return { blocks, current };
}

/** Put the doc's one paywall marker after the n-th block with text (0: no free part removed). */
export function placeWall(editor: any, afterBlocks: number | null): void {
  if (!editor) return;
  editor.chain().command(({ tr, state }: any) => {
    const positions: number[] = [];
    tr.doc.forEach((node: any, offset: number) => { if (node.type.name === 'horizontalRule' && node.attrs?.paywall) positions.push(offset); });
    for (const p of positions.reverse()) tr.delete(p, p + 1);
    if (afterBlocks === null) return true;
    let seen = 0;
    let insertAt: number | null = null;
    tr.doc.forEach((node: any, offset: number) => {
      if (insertAt !== null) return;
      if (node.textContent.trim()) seen++;
      if (seen === afterBlocks) insertAt = offset + node.nodeSize;
    });
    if (insertAt === null) return true;
    tr.insert(insertAt, state.schema.nodes.horizontalRule.create({ paywall: true }));
    return true;
  }).run();
}

/** The publish result in words: "Sent to 524", "Scheduled for Oct 14, 9:00 AM" or "Published". */
export function publishedText(r: { status?: string; email?: string; publish_at?: string }, at: string, updated = false): string {
  const sentTo = r.email?.match(/Sending to (\d+)/)?.[1];
  const text = r.status === 'scheduled'
    ? `Scheduled for ${new Date(r.publish_at || at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : r.status === 'draft' ? 'Saved as a draft on your site'
    : sentTo ? `Sent to ${Number(sentTo).toLocaleString()}` : updated ? 'Updated' : 'Published';
  return r.email && !sentTo && !/emailed when/.test(r.email) ? `${text}. ${r.email}` : text;
}
