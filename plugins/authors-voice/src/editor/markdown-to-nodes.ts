/**
 * File: markdownToNodes.ts
 * Purpose: Deterministic Markdown → TipTap JSON converter for the editor path. The writing
 *   model now returns pure prose (Markdown); this builds the structured nodes server-side so
 *   the response contract to OpenWriter is unchanged (it still receives TipTap JSON).
 *
 * Why deterministic (not the LLM): node construction is mechanical, not prose. markdown-it is
 *   pure JS (Workers-safe). Output mirrors OpenWriter's TipTap schema (StarterKit nodes +
 *   bold/italic/strike/code/link marks). Node ids are emitted but the OpenWriter client ignores
 *   them — it applies edits by its own captured node ids — so any unique id is fine.
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

type JSONNode = { type: string; attrs?: Record<string, unknown>; content?: JSONNode[]; text?: string; marks?: Array<Record<string, unknown>> };

function genId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function emptyParagraph(): JSONNode {
  return { type: 'paragraph', attrs: { id: genId() }, content: [] };
}

/** Remove the last mark of a given type from the active-mark stack. */
function popMark(stack: Array<Record<string, unknown>>, type: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type === type) { stack.splice(i, 1); return; }
  }
}

function textNode(text: string, marks: Array<Record<string, unknown>>): JSONNode {
  const node: JSONNode = { type: 'text', text };
  if (marks.length > 0) node.marks = marks.map((m) => ({ ...m }));
  return node;
}

/** Merge adjacent text nodes that carry identical marks — cleaner, less fragmented output. */
function mergeAdjacent(nodes: JSONNode[]): JSONNode[] {
  const out: JSONNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev && prev.type === 'text' &&
        JSON.stringify(prev.marks || null) === JSON.stringify(n.marks || null)) {
      prev.text = (prev.text || '') + (n.text || '');
    } else {
      out.push(n);
    }
  }
  return out;
}

/** Walk a markdown-it inline token's children into TipTap inline content. */
function parseInline(token: any): JSONNode[] {
  const out: JSONNode[] = [];
  const marks: Array<Record<string, unknown>> = [];
  for (const t of (token?.children || [])) {
    switch (t.type) {
      case 'text': if (t.content) out.push(textNode(t.content, marks)); break;
      case 'softbreak': out.push(textNode(' ', marks)); break;
      case 'hardbreak': out.push({ type: 'hardBreak' }); break;
      case 'code_inline': out.push(textNode(t.content, [...marks, { type: 'code' }])); break;
      case 'strong_open': marks.push({ type: 'bold' }); break;
      case 'strong_close': popMark(marks, 'bold'); break;
      case 'em_open': marks.push({ type: 'italic' }); break;
      case 'em_close': popMark(marks, 'italic'); break;
      case 's_open': marks.push({ type: 'strike' }); break;
      case 's_close': popMark(marks, 'strike'); break;
      case 'link_open': marks.push({ type: 'link', attrs: { href: t.attrGet('href') || '' } }); break;
      case 'link_close': popMark(marks, 'link'); break;
      case 'image': if (t.content) out.push(textNode(t.content, marks)); break; // alt text only
      default: if (t.content) out.push(textNode(t.content, marks));
    }
  }
  return mergeAdjacent(out);
}

/** Find the matching close token for a nested open/close pair. */
function findClose(tokens: any[], openIdx: number, openType: string, closeType: string): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].type === openType) depth++;
    else if (tokens[i].type === closeType) { depth--; if (depth === 0) return i; }
  }
  return tokens.length;
}

/** Walk a range of block-level markdown-it tokens into TipTap nodes. */
function parseBlocks(tokens: any[], start: number, end: number): JSONNode[] {
  const nodes: JSONNode[] = [];
  let i = start;
  while (i < end) {
    const t = tokens[i];
    switch (t.type) {
      case 'paragraph_open': {
        nodes.push({ type: 'paragraph', attrs: { id: genId() }, content: parseInline(tokens[i + 1]) });
        i += 3; break;
      }
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) || 1;
        nodes.push({ type: 'heading', attrs: { level, id: genId() }, content: parseInline(tokens[i + 1]) });
        i += 3; break;
      }
      case 'bullet_list_open': {
        const close = findClose(tokens, i, 'bullet_list_open', 'bullet_list_close');
        nodes.push({ type: 'bulletList', attrs: { id: genId() }, content: parseBlocks(tokens, i + 1, close) });
        i = close + 1; break;
      }
      case 'ordered_list_open': {
        const close = findClose(tokens, i, 'ordered_list_open', 'ordered_list_close');
        const startAttr = t.attrGet ? t.attrGet('start') : null;
        const attrs: Record<string, unknown> = { id: genId() };
        if (startAttr) attrs.start = Number(startAttr);
        nodes.push({ type: 'orderedList', attrs, content: parseBlocks(tokens, i + 1, close) });
        i = close + 1; break;
      }
      case 'list_item_open': {
        const close = findClose(tokens, i, 'list_item_open', 'list_item_close');
        nodes.push({ type: 'listItem', attrs: { id: genId() }, content: parseBlocks(tokens, i + 1, close) });
        i = close + 1; break;
      }
      case 'blockquote_open': {
        const close = findClose(tokens, i, 'blockquote_open', 'blockquote_close');
        nodes.push({ type: 'blockquote', attrs: { id: genId() }, content: parseBlocks(tokens, i + 1, close) });
        i = close + 1; break;
      }
      case 'fence':
      case 'code_block': {
        const language = (t.info || '').trim().split(/\s+/)[0] || null;
        const code = (t.content || '').replace(/\n$/, '');
        nodes.push({ type: 'codeBlock', attrs: { language, id: genId() }, content: code ? [{ type: 'text', text: code }] : [] });
        i += 1; break;
      }
      case 'hr': {
        nodes.push({ type: 'horizontalRule', attrs: { id: genId() } });
        i += 1; break;
      }
      default: i += 1; // skip unsupported tokens (tables, html, etc.)
    }
  }
  return nodes;
}

/**
 * Convert a Markdown string to an array of TipTap JSON nodes. Always returns at least one node
 * (an empty paragraph) so callers never get an empty array.
 */
export function markdownToNodes(markdown: string): JSONNode[] {
  const src = (markdown || '').trim();
  if (!src) return [emptyParagraph()];
  const tokens = md.parse(src, {});
  const nodes = parseBlocks(tokens, 0, tokens.length);
  return nodes.length > 0 ? nodes : [emptyParagraph()];
}
