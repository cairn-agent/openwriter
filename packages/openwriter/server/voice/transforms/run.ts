/**
 * A document transform from the sidebar (Vary, Shrinkify, Expandify, Threadify, Storify,
 * Emailify, Postify): the publish plugin's sidebar handler, moved here as it was, with the model
 * call made in-process on the writer's key instead of on the publish server. The result is a new
 * document beside the source (a variant), pending review.
 * adr: adr/authors-voice.md
 */

import { createDocument, VoiceError } from '../host.js';
import { TransformService, VALID_TRANSFORM_ACTIONS, type TransformAction } from './transforms.js';

/** Server-side backstop for the transform size guard. Mirrors the client-side
 *  cap in packages/openwriter/src/sidebar/transform-guard.ts (same 5000-word unit). */
const MAX_TRANSFORM_WORDS = 5000;

/** Word count of a doc's body. Strips a leading YAML frontmatter block so the
 *  count matches the body-only wordCount the sidebar measures client-side. */
function countBodyWords(rawContent: string): number {
  const body = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return (body.match(/\S+/g) || []).length;
}

/** Map transform action to variant content type */
const ACTION_VARIANT_TYPE: Record<string, string> = {
  vary: 'document',
  shrinkify: 'document',
  expandify: 'document',
  threadify: 'tweet',
  storify: 'document',
  emailify: 'newsletter',
  postify: 'tweet',
};

/** Simple HTML → markdown conversion for document creation */
function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<p[^>]*>/gi, '');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

/** Extract docId from raw markdown frontmatter (JSON or YAML) */
function extractDocId(rawContent: string): string | null {
  const jsonMatch = rawContent.match(/"docId"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const yamlMatch = rawContent.match(/^docId:\s*["']?(\S+?)["']?\s*$/m);
  if (yamlMatch) return yamlMatch[1];
  return null;
}

export function isTransformAction(action: string): action is TransformAction {
  return (VALID_TRANSFORM_ACTIONS as string[]).includes(action);
}

export async function runTransform(params: { action: TransformAction; content: string; title: string; instructions?: string }) {
  const { action, content, title, instructions } = params;
  if (!content) throw new VoiceError(400, 'bad_request', 'Document content is required');

  const transformWords = countBodyWords(content);
  if (transformWords > MAX_TRANSFORM_WORDS) {
    throw new VoiceError(413, 'too_large', `Document too large to transform: ${transformWords.toLocaleString()} words (max ${MAX_TRANSFORM_WORDS.toLocaleString()}).`);
  }

  const transformResult = await TransformService.transform({ action, content, title, instructions, env: {} });

  // Convert HTML output to markdown for document creation
  const markdownContent = htmlToMarkdown(transformResult.html);

  // Extract source doc's docId for variant relationship
  const masterDocId = extractDocId(content);
  const variantType = ACTION_VARIANT_TYPE[action] || 'document';

  // Build document creation payload
  const createBody: Record<string, any> = {
    title: transformResult.newTitle,
    content: markdownContent,
    markPending: true,
    agentCreated: true,
    ...(masterDocId ? { masterDocId, variantType } : {}),
  };

  if (action === 'threadify') {
    // Build TipTap JSON directly — markdown parser converts "- item" lines
    // to bulletList nodes the tweet editor can't render. Using paragraph +
    // hardBreak nodes keeps all tweet text as plain text.
    if (transformResult.thread?.tweets?.length) {
      const docContent: any[] = [];
      transformResult.thread.tweets.forEach((t: { text: string }, i: number) => {
        const lines = t.text.split('\n');
        const nodes: any[] = [];
        lines.forEach((line: string, j: number) => {
          if (j > 0) nodes.push({ type: 'hardBreak' });
          if (line) nodes.push({ type: 'text', text: line });
        });
        if (nodes.length) {
          docContent.push({ type: 'paragraph', content: nodes });
        }
        if (i < transformResult.thread!.tweets.length - 1) {
          docContent.push({ type: 'horizontalRule' });
        }
      });
      createBody.content = { type: 'doc', content: docContent };
    }
    createBody.metadata = { tweetContext: { mode: 'tweet' } };
  }

  const docResult = createDocument(createBody);
  return {
    success: true,
    action,
    filename: docResult.filename,
    title: transformResult.newTitle,
    metadata: transformResult.metadata,
  };
}
