/**
 * Post blocks for writers without the agent: each block is a plain-text marker line the
 * publishing server understands ([paid-only] ... [/paid-only], [callout], [drop-cap],
 * [subscribe], [poll] with a list of choices, [survey] and a survey's address, a file's link on
 * its own line). These helpers
 * write them into the open document at the cursor, or around the selected paragraphs.
 */
import { callTool } from './bridge';

const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

/** Where the top-level blocks of a range start and end (the document's direct children). */
function blockBounds(editor: any, from: number, to: number): { start: number; end: number } {
  const doc = editor.state.doc;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const start = $from.depth > 0 ? $from.before(1) : from;
  const end = $to.depth > 0 ? $to.after(1) : to;
  return { start, end };
}

/** Wrap the selected paragraphs in an open and close marker, or put an example part at the cursor. */
export function wrapBlock(editor: any, sel: { from: number; to: number }, open: string, close: string, example: string): void {
  const { start, end } = blockBounds(editor, sel.from, sel.to);
  if (sel.to > sel.from) {
    editor.chain().insertContentAt(end, para(close)).insertContentAt(start, para(open)).run();
  } else {
    editor.chain().insertContentAt(end, [para(open), para(example), para(close)]).run();
  }
}

/** A marker line on its own before the block at the cursor (drop cap) or after it (the rest). */
export function insertLine(editor: any, sel: { from: number; to: number }, text: string, before = false): void {
  const { start, end } = blockBounds(editor, sel.from, sel.to);
  editor.chain().insertContentAt(before ? start : end, para(text)).run();
}

export function insertPoll(editor: any, sel: { from: number; to: number }): void {
  const { end } = blockBounds(editor, sel.from, sel.to);
  const item = (t: string) => ({ type: 'listItem', content: [para(t)] });
  editor.chain().insertContentAt(end, [
    para('[poll] Your question?'),
    { type: 'bulletList', content: [item('First choice'), item('Second choice')] },
  ]).run();
}

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Upload a file the writer picks and put its download link on a line of its own. */
export async function attachFile(editor: any, sel: { from: number; to: number }, file: File, site?: string): Promise<string> {
  const r = await callTool<{ name: string; url: string }>('attach_file_to_post', {
    content_base64: toBase64(await file.arrayBuffer()), name: file.name, ...(site ? { site } : {}),
  });
  const { end } = blockBounds(editor, sel.from, sel.to);
  editor.chain().insertContentAt(end, {
    type: 'paragraph', content: [{ type: 'text', text: r.name, marks: [{ type: 'link', attrs: { href: r.url } }] }],
  }).run();
  return r.name;
}

export const BLOCKS = [
  { id: 'paid', label: 'Part for paid readers only', hint: 'Free readers skip it; a part for free readers can tell them what they miss' },
  { id: 'free', label: 'Part for free readers only', hint: 'Paid readers do not see it' },
  { id: 'callout', label: 'Callout box', hint: 'A highlighted box' },
  { id: 'dropcap', label: 'Drop cap', hint: 'A large first letter on this paragraph' },
  { id: 'subscribe', label: 'Subscribe button', hint: 'The subscribe form, right here' },
  { id: 'poll', label: 'Poll', hint: 'A question with 2 to 6 choices' },
  { id: 'survey', label: 'Survey', hint: 'A card that opens one of your surveys' },
  { id: 'file', label: 'Attach a file', hint: 'PDF, EPUB, ZIP and more, up to 20 MB' },
] as const;
export type BlockId = (typeof BLOCKS)[number]['id'];

/** The open surveys a post can show, for the Survey block's list. */
export async function openSurveys(): Promise<Array<{ slug: string; title: string }>> {
  const r = await callTool<{ surveys: Array<{ slug: string; title: string; closed: boolean }> }>('list_surveys', {});
  return r.surveys.filter((s) => !s.closed);
}

/** Insert one block; a file is picked first, a survey is chosen first (survey). Returns what to tell the writer. */
export async function insertBlock(id: BlockId, editor: any, sel: { from: number; to: number }, pickFile: () => Promise<File | null>, survey?: string): Promise<string | null> {
  switch (id) {
    case 'paid': wrapBlock(editor, sel, '[paid-only]', '[/paid-only]', 'Only paid readers see this.'); return 'Added a part for paid readers. Write it between the two marker lines.';
    case 'free': wrapBlock(editor, sel, '[free-only]', '[/free-only]', 'Only free readers see this.'); return 'Added a part for free readers. Write it between the two marker lines.';
    case 'callout': wrapBlock(editor, sel, '[callout]', '[/callout]', 'Something readers should not miss.'); return null;
    case 'dropcap': insertLine(editor, sel, '[drop-cap]', true); return 'The paragraph below the marker starts with a large letter.';
    case 'subscribe': insertLine(editor, sel, '[subscribe]'); return 'Readers see a subscribe button here.';
    case 'poll': insertPoll(editor, sel); return 'Edit the question and the choices; readers vote on the post.';
    case 'survey': if (!survey) return null; insertLine(editor, sel, `[survey] ${survey}`); return 'Readers see a card that opens the survey.';
    case 'file': {
      const file = await pickFile();
      if (!file) return null;
      return `Attached ${await attachFile(editor, sel, file)}.`;
    }
  }
}
