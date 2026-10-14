/**
 * Writing in the writer's voice, on their own Claude key: part of OpenWriter, always on.
 *
 *  - Editor, on selected text: Enhance, Modify..., Shrink, Expand; on an empty line: Insert,
 *    Fill paragraph, Fill sentence. POST /api/voice/apply-editor keeps Author's Voice's request
 *    and response shape (src/context-menu/ContextMenu.tsx sends it).
 *  - Sidebar, on a document: Learn my voice from this (also on a folder: every document in it),
 *    and the transforms Vary, Shrinkify, Expandify, Threadify, Storify, Emailify, Postify.
 *    OpenWriter forwards `voice:` actions to POST /api/voice/sidebar-action.
 *  - Settings > Claude: the key and the writing model (GET/PUT /api/voice/settings), and with no
 *    key the OpenWriter balance (GET /api/voice/balance and its top-up, settings and card routes,
 *    passed to OpenWriter's server on the writer's account).
 *
 * The voice is the writer's own documents: enriched with the search engine's prompts into a
 * local index, searched for examples on every rewrite, and analysed into a voice profile.
 * adr: adr/authors-voice.md
 */

import type { Express, Request, Response } from 'express';
import { describeSettings, explainApiError, isPlausibleKey, keyManagedElsewhere, saveSettings, VoiceError, dataDir } from './host.js';
import { runEditor } from './editor/apply.js';
import { markdownToNodes } from './editor/markdown-to-nodes.js';
import { addToVoice, docIdFromMarkdown, voiceAddsRunning, voiceMessage } from './voice/voice-enrich.js';
import { platformFetch } from '../connections.js';
import { voiceIndex } from './voice/voice-index.js';
import { buildProfile, readProfile } from './profile/build.js';
import { isTransformAction, runTransform } from './transforms/run.js';
import { MODELS, modelFor, type ModelChoice } from './models.js';

/** How long the sidebar's add waits before answering that the run continues in the background. */
const VOICE_WAIT_MS = 45_000;

function sendError(res: Response, err: unknown): void {
  const e = err instanceof VoiceError ? err : explainApiError(err);
  res.status(e.status).json({ error: e.message, message: e.message, code: e.code });
}

/** How long after the last add finishes before the profile is rebuilt. */
const PROFILE_SETTLE_MS = 3000;
let profileTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Rebuild the voice profile after the voice changed, once per batch: a folder sends every document
 * at once, so the rebuild waits until no add is running (each rebuild is a paid Sonnet call on the
 * balance). A failure is retried on the next add.
 */
function refreshProfile(): void {
  if (profileTimer) clearTimeout(profileTimer);
  profileTimer = setTimeout(() => {
    profileTimer = null;
    if (voiceAddsRunning() > 0) return; // the last add to finish schedules it again
    buildProfile().catch((err) => console.warn('[voice] profile build failed:', err?.message || err));
  }, PROFILE_SETTLE_MS);
}

/** One of the balance routes on OpenWriter's server, on the writer's account. */
function balanceRoute(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string) {
  return async (req: Request, res: Response) => {
    try {
      const r = await platformFetch(`/ai${path}`, { method, ...(method === 'GET' ? {} : { body: JSON.stringify(req.body ?? {}) }) });
      res.status(r.status).json(await r.json().catch(() => ({})));
    } catch {
      res.status(409).json({ error: 'not_signed_in', message: 'Sign in to OpenWriter to use the balance.' });
    }
  };
}

/** The choices with the model behind each now, e.g. Opus is Claude Opus 5.5. */
async function settingsAnswer() {
  const models = await Promise.all((Object.keys(MODELS) as ModelChoice[]).map(async (choice) => (
    { choice, label: MODELS[choice].label, name: (await modelFor(choice)).name }
  )));
  return { ...describeSettings(), models };
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
      run.then(refreshProfile, refreshProfile); // a failure is reported to the writer below
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
  app.get('/api/voice/settings', async (_req: Request, res: Response) => {
    res.json(await settingsAnswer());
  });

  // The OpenWriter balance, for writers without a key (Settings > Claude).
  app.get('/api/voice/balance', balanceRoute('GET', '/balance'));
  app.post('/api/voice/balance/topup', balanceRoute('POST', '/topup'));
  app.put('/api/voice/balance/settings', balanceRoute('PUT', '/settings'));
  app.delete('/api/voice/balance/card', balanceRoute('DELETE', '/card'));

  app.put('/api/voice/settings', async (req: Request, res: Response) => {
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
      res.json(await settingsAnswer());
    } catch {
      res.status(500).json({ error: 'Could not save the settings.' });
    }
  });
}

export { runEditor, type EditorRequest, LENGTH_HINTS, type LengthHint, MAX_SELECTION_WORDS } from './editor/apply.js';
export { VoiceError, explainApiError, redactKey, type ClientFactory } from './host.js';
export { MODELS, DEFAULT_REWRITE_MODEL, DEFAULT_CHAT_MODEL, modelFor, resolveChoice, type ModelChoice, type LiveModel } from './models.js';
