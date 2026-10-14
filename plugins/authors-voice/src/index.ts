/**
 * Author's Voice for OpenWriter: right-click actions that run on the writer's own Claude key.
 *
 *  - Editor, on selected text: Enhance, Modify..., Shrink, Expand; on an empty line: Insert,
 *    Fill paragraph, Fill sentence. POST /api/voice/apply-editor keeps Author's Voice's request
 *    and response shape, so the editor's menu works as it always has.
 *  - Sidebar, on a document: Add to Author's Voice (also on a folder: every document in it),
 *    and the transforms Vary, Shrinkify, Expandify, Threadify, Storify, Emailify, Postify.
 *
 * The voice is the writer's own documents: enriched with the search engine's prompts into a local index,
 * searched for examples on every rewrite, and analysed into a voice profile.
 * adr: adr/authors-voice.md
 */

import type { Request, Response, Router } from 'express';
import { bindHost, explainApiError, setClientFactory, setKeyLoader, VoiceError, PLUGIN_NAME, type ClientFactory, type ToolDef } from './host.js';
import { runEditor } from './editor/apply.js';
import { markdownToNodes } from './editor/markdown-to-nodes.js';
import { addToVoice, docIdFromMarkdown, voiceMessage } from './voice/voice-enrich.js';
import { voiceIndex } from './voice/voice-index.js';
import { buildProfile, readProfile } from './profile/build.js';
import { isTransformAction, runTransform } from './transforms/run.js';
import { dataDir } from './host.js';

export { runEditor, type EditorRequest, LENGTH_HINTS, type LengthHint, MAX_SELECTION_WORDS } from './editor/apply.js';
export { addToVoice, voiceMessage, VoiceError } from './voice/voice-enrich.js';
export { MODELS, resolveModel, DEFAULT_REWRITE_MODEL, DEFAULT_CHAT_MODEL, type ModelChoice } from './models.js';
export { recordUsage, readUsage, tokenCounts, type UsageEntry } from './usage-log.js';
export { explainApiError, redactKey } from './host.js';

/** How long the sidebar's Add waits before answering that the run continues in the background. */
const VOICE_WAIT_MS = 45_000;

interface PluginRouteContext {
  app: Router;
  config: Record<string, string>;
  readonly dataDir: string;
  configFile: string;
  host: {
    tools(): ReadonlyArray<ToolDef>;
    createDocument(body: Record<string, any>, tab?: string): { filename: string; title: string };
    rootDir: string;
  };
}

export interface AuthorsVoiceOptions {
  /** Keep the writer's key outside OpenWriter's settings (an embedder that encrypts it). */
  loadKey?: () => string | null;
  /** Stand in for Anthropic (tests). */
  clientFactory?: ClientFactory;
}

function sendError(res: Response, err: unknown): void {
  const e = err instanceof VoiceError ? err : explainApiError(err);
  res.status(e.status).json({ error: e.message, message: e.message, code: e.code });
}

/** Rebuild the voice profile after the voice changed; a failure is retried on the next add. */
function refreshProfile(): void {
  buildProfile().catch((err) => console.warn("[Author's Voice] profile build failed:", err?.message || err));
}

export function createAuthorsVoicePlugin(options: AuthorsVoiceOptions = {}) {
  return {
    name: PLUGIN_NAME,
    version: '1.0.0',
    displayName: "Author's Voice",
    description: 'Rewrite, fill and transform text in your voice, on your own Claude API key',
    category: 'writing' as const,

    configSchema: options.loadKey ? {} : {
      'anthropic-api-key': {
        type: 'string' as const,
        required: true,
        description: 'Your Claude API key (sk-ant-...), from console.anthropic.com',
      },
      'model': {
        type: 'select' as const,
        description: 'Writing model',
        options: [
          { value: '', label: 'Default (Opus)' },
          { value: 'opus', label: 'Opus (best quality)' },
          { value: 'sonnet', label: 'Sonnet' },
          { value: 'haiku', label: 'Haiku (fastest, cheapest)' },
        ],
      },
    },

    registerRoutes(ctx: PluginRouteContext) {
      bindHost({
        dataDir: () => ctx.dataDir,
        rootDir: () => ctx.host.rootDir,
        tools: () => ctx.host.tools(),
        createDocument: (body) => ctx.host.createDocument(body),
        configFile: ctx.configFile,
        config: ctx.config,
      });
      if (options.loadKey) setKeyLoader(options.loadKey);
      if (options.clientFactory) setClientFactory(options.clientFactory);

      // The editor's right-click actions, in Author's Voice's request and response shape.
      ctx.app.post('/api/voice/apply-editor', async (req: Request, res: Response) => {
        try {
          const b = req.body ?? {};
          const { markdown, action, model } = await runEditor({
            docId: String(b.docId || b.documentId || ''),
            nodeIds: b.nodeIds,
            nodes: b.nodes,
            contextBefore: b.contextBefore,
            contextAfter: b.contextAfter,
            instruction: b.instruction,
            action: b.action,
            fullDocument: typeof b.fullDocument === 'string' ? b.fullDocument : undefined,
          });
          res.json({ success: true, nodes: markdownToNodes(markdown), metadata: { action, model } });
        } catch (err) {
          sendError(res, err);
        }
      });

      // The sidebar's right-click actions on a document.
      ctx.app.post('/api/voice/sidebar-action', async (req: Request, res: Response) => {
        const { action, title, instructions, content } = req.body ?? {};
        const name = String(title || 'This document');
        try {
          if (isTransformAction(action)) {
            res.json(await runTransform({ action, content: String(content ?? ''), title: name, instructions }));
            return;
          }
          if (action !== 'add-to-corpus') {
            res.status(404).json({ error: `Unknown action "${action}".` });
            return;
          }
          const docId = docIdFromMarkdown(String(content ?? ''));
          if (!docId) { res.status(400).json({ error: `"${name}" could not be read.` }); return; }
          const run = addToVoice(docId);
          run.then(refreshProfile, () => { /* reported to the writer below */ });
          const waited = await Promise.race([
            run.then((r) => ({ r }), (err) => ({ err })),
            new Promise<null>((ok) => setTimeout(() => ok(null), VOICE_WAIT_MS)),
          ]);
          if (!waited) {
            res.json({ success: true, running: true, message: `Adding "${name}" to your voice. Long documents finish in the background.` });
          } else if ('r' in waited) {
            res.json({ success: true, ...waited.r, message: voiceMessage(waited.r) });
          } else {
            sendError(res, waited.err);
          }
        } catch (err) {
          sendError(res, err);
        }
      });

      // What is in the voice: the documents added, and the profile built from them.
      ctx.app.get('/api/voice/status', (_req: Request, res: Response) => {
        const p = readProfile();
        const g = p?.guidelines?.author_voice_guidelines;
        res.json({
          documents: voiceIndex(dataDir()).status(),
          profile: p ? {
            analyzedAt: p.analyzedAt,
            analyzedWords: p.analyzedWords,
            confidence: g?.confidence ?? null,
            summary: g?.user_friendly_summary ?? null,
            anchorBlend: p.anchorBlend,
          } : null,
        });
      });
    },

    contextMenuItems() {
      return [
        // Selection actions (require highlighted text)
        { label: 'Enhance', shortcut: 'R', action: 'av:rewrite', condition: 'has-selection' as const },
        { label: 'Modify...', action: 'av:custom', condition: 'has-selection' as const, promptForInput: true },
        { label: 'Shrink', shortcut: 'S', action: 'av:shrink', condition: 'has-selection' as const },
        { label: 'Expand', shortcut: 'E', action: 'av:expand', condition: 'has-selection' as const },
        // Empty node actions (cursor on empty line)
        { label: 'Insert', shortcut: 'I', action: 'av:insert', condition: 'empty-node' as const, promptForInput: true },
        { label: 'Fill paragraph', shortcut: 'F', action: 'av:fill', condition: 'empty-node' as const },
        { label: 'Fill sentence', action: 'av:fill-sentence', condition: 'empty-node' as const },
      ];
    },

    // Sidebar (file tree) right-click. `voice:` routes to POST /api/voice/sidebar-action.
    // folderCapable: also on a workspace or container, applied to every document in it.
    sidebarMenuItems() {
      return [
        { label: "Add to Author's Voice", action: 'voice:add-to-corpus', folderCapable: true },
        { label: 'Vary', action: 'voice:vary', promptForFocus: true },
        { label: 'Shrinkify', action: 'voice:shrinkify', promptForFocus: true },
        { label: 'Expandify', action: 'voice:expandify', promptForFocus: true },
        { label: 'Threadify', action: 'voice:threadify', promptForFocus: true },
        { label: 'Storify', action: 'voice:storify', promptForFocus: true },
        { label: 'Emailify', action: 'voice:emailify', promptForFocus: true },
        { label: 'Postify', action: 'voice:postify', promptForFocus: true },
      ];
    },
  };
}

export default createAuthorsVoicePlugin();
