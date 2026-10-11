/**
 * HTTP for the writer's key, inline edits and the chat.
 *
 *   GET    /api/ai/status            key state (last four characters at most) and the model choices
 *   PUT    /api/ai/key               save the key; the answer never contains it
 *   DELETE /api/ai/key               remove it
 *   POST   /api/ai/inline-edit       rewrite a selection; the result is a pending change
 *   GET    /api/ai/chats?docId=      a document's conversations, newest first
 *   GET    /api/ai/chats/:id         one conversation
 *   POST   /api/ai/chats             send a message; the answer streams as NDJSON events
 *   POST   /api/ai/chats/:id/stop    stop the running answer
 *   POST   /api/ai/chats/:id/confirm the writer's confirm or cancel for a paused tool
 *
 * adr: adr/writer-key-ai.md
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { describeKey, isPlausibleKey, removeKey, saveKey } from './key-store.js';
import { DEFAULT_CHAT_MODEL, DEFAULT_REWRITE_MODEL, MODELS } from './models.js';
import { InlineEditError, runInlineEdit, type ClientFactory } from './inline-edit.js';
import { getChat, isChatId, listChats, newChat } from './chat-store.js';
import { answerConfirmation, isChatRunning, runChatTurn, stopChat, type ChatDeps, type ChatEvent } from './chat-runner.js';

export interface AiRouterDeps {
  /** Tests stand in for Anthropic here; production uses the real SDKs. */
  inlineClient?: ClientFactory;
  chat?: ChatDeps;
}

export function createAiRouter(deps: AiRouterDeps = {}): Router {
  const router = Router();

  router.get('/api/ai/status', (_req, res) => {
    res.json({
      key: describeKey(),
      models: Object.entries(MODELS).map(([choice, m]) => ({ choice, label: m.label })),
      defaultRewriteModel: DEFAULT_REWRITE_MODEL,
      defaultChatModel: DEFAULT_CHAT_MODEL,
    });
  });

  router.put('/api/ai/key', (req, res) => {
    const key = req.body?.key;
    if (!isPlausibleKey(key)) {
      res.status(400).json({ error: 'That does not look like an Anthropic API key. It starts with sk-ant-.' });
      return;
    }
    try {
      saveKey(key);
      res.json({ key: describeKey() });
    } catch {
      res.status(500).json({ error: 'Could not save the key.' });
    }
  });

  router.delete('/api/ai/key', (_req, res) => {
    removeKey();
    res.json({ key: describeKey() });
  });

  router.post('/api/ai/inline-edit', async (req, res) => {
    try {
      res.json(await runInlineEdit(req.body ?? {}, deps.inlineClient));
    } catch (err) {
      if (err instanceof InlineEditError) res.status(err.status).json({ error: err.message, code: err.code });
      else res.status(500).json({ error: 'The rewrite failed.', code: 'failed' });
    }
  });

  router.get('/api/ai/chats', (req, res) => {
    const docId = typeof req.query.docId === 'string' && req.query.docId ? req.query.docId : null;
    res.json({ chats: listChats(docId) });
  });

  router.get('/api/ai/chats/:id', (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) { res.status(404).json({ error: 'No such chat.' }); return; }
    res.json({ chat, running: isChatRunning(chat.id) });
  });

  router.post('/api/ai/chats', async (req: Request, res: Response) => {
    const { chatId, docId, docTitle, message, model } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) { res.status(400).json({ error: 'Type a message.' }); return; }
    const doc = typeof docId === 'string' && docId ? { docId, title: typeof docTitle === 'string' ? docTitle : undefined } : null;
    let chat = chatId ? getChat(chatId) : null;
    if (chatId && !chat) { res.status(404).json({ error: 'No such chat.' }); return; }
    if (!chat) chat = newChat(doc?.docId ?? null, typeof model === 'string' ? model : DEFAULT_CHAT_MODEL);

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let finished = false;
    const emit = (event: ChatEvent) => { if (!res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
    // The writer closed the tab or lost the connection: nobody is left to confirm, so stop.
    res.on('close', () => { if (!finished) stopChat(chat!.id); });
    await runChatTurn({ chat, message: message.trim(), doc, model: typeof model === 'string' ? model : undefined, emit }, deps.chat);
    finished = true;
    res.end();
  });

  router.post('/api/ai/chats/:id/stop', (req, res) => {
    res.json({ stopped: stopChat(req.params.id) });
  });

  router.post('/api/ai/chats/:id/confirm', (req, res) => {
    const { requestId, allow } = req.body ?? {};
    if (!isChatId(req.params.id) || typeof requestId !== 'string') { res.status(400).json({ error: 'Bad request.' }); return; }
    const ok = answerConfirmation(req.params.id, requestId, allow === true);
    res.status(ok ? 200 : 404).json({ ok });
  });

  return router;
}
