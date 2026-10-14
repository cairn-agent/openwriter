/**
 * Writing in the writer's voice, on their own Claude key: part of OpenWriter, always on.
 *
 *  - Editor, on selected text: Enhance, Modify..., Shrink, Expand; on an empty line: Insert,
 *    Fill paragraph, Fill sentence. POST /api/voice/apply-editor keeps Author's Voice's request
 *    and response shape (src/context-menu/ContextMenu.tsx sends it).
 *  - Sidebar, on a document: Learn my voice from this (also on a folder: every document in it),
 *    and the transforms Vary, Shrinkify, Expandify, Threadify, Storify, Emailify, Postify.
 *    OpenWriter forwards `voice:` actions to POST /api/voice/sidebar-action.
 *  - Settings > Claude: the key and the writing model (GET/PUT /api/voice/settings).
 *
 * The voice is the writer's own documents: enriched with the search engine's prompts into a
 * local index, searched for examples on every rewrite, and analysed into a voice profile.
 * adr: adr/authors-voice.md
 */

import type { Express, Request, Response } from 'express';
import { describeSettings, explainApiError, isPlausibleKey, keyManagedElsewhere, saveSettings, VoiceError, dataDir } from './host.js';
import { runEditor } from './editor/apply.js';
import { markdownToNodes } from './editor/markdown-to-nodes.js';
import { addToVoice, docIdFromMarkdown, voiceMessage } from './voice/voice-enrich.js';
import { voiceIndex } from './voice/voice-index.js';
import { buildProfile, readProfile } from './profile/build.js';
import { isTransformAction, runTransform } from './transforms/run.js';
import { MODELS } from './models.js';

/** How long the sidebar's add waits before answering that the run continues in the background. */
const VOICE_WAIT_MS = 45_000;

function sendError(res: Response, err: unknown): void {
  const e = err instanceof VoiceError ? err : explainApiError(err);
  res.status(e.status).json({ error: e.message, message: e.message, code: e.code });
}

/** Rebuild the voice profile after the voice changed; a failure is retried on the next add. */
function refreshProfile(): void {
  buildProfile().catch((err) => console.warn('[voice] profile build failed:', err?.message || err));
}

function settingsAnswer() {
  return { ...describeSettings(), models: Object.entries(MODELS).map(([choice, m]) => ({ choice, label: m.label })) };
}

export function registerVoiceRoutes(app: Express): void {
  // The editor's right-click actions, in Author's Voice's request and response shape.
  app.post('/api/voice/apply-editor', async (req: Request, res: Response) => {
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
  app.post('/api/voice/sidebar-action', async (req: Request, res: Response) => {
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
        res.json({ success: true, running: true, message: `Learning your voice from "${name}". Long documents finish in the background.` });
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
  app.get('/api/voice/status', (_req: Request, res: Response) => {
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

  // Settings > Claude. The answer never holds the key: whether one is saved and its last four.
  app.get('/api/voice/settings', (_req: Request, res: Response) => {
    res.json(settingsAnswer());
  });

  app.put('/api/voice/settings', (req: Request, res: Response) => {
    const { key, model } = req.body ?? {};
    if (key !== undefined) {
      if (keyManagedElsewhere()) { res.status(409).json({ error: 'The key is managed by this server.' }); return; }
      if (key !== null && !isPlausibleKey(key)) {
        res.status(400).json({ error: 'That does not look like a Claude API key. It starts with sk-ant-.' });
        return;
      }
    }
    if (model !== undefined && model !== '' && !(model in MODELS)) { res.status(400).json({ error: 'Unknown model.' }); return; }
    try {
      saveSettings({ key, model });
      res.json(settingsAnswer());
    } catch {
      res.status(500).json({ error: 'Could not save the settings.' });
    }
  });
}

export { runEditor, type EditorRequest, LENGTH_HINTS, type LengthHint, MAX_SELECTION_WORDS } from './editor/apply.js';
export { VoiceError, explainApiError, redactKey, type ClientFactory } from './host.js';
