/**
 * Browser side of /api/ai/*: the writer's key, inline rewrites and the chat.
 * The key goes to the server once and never comes back; the browser only ever
 * sees whether one is saved and its last four characters.
 */

export type ModelChoice = 'opus' | 'sonnet' | 'haiku';

export interface KeyState {
  saved: boolean;
  last4?: string;
  savedAt?: string;
  usable?: boolean;
}

export interface AiStatus {
  key: KeyState;
  models: Array<{ choice: ModelChoice; label: string }>;
  defaultRewriteModel: ModelChoice;
  defaultChatModel: ModelChoice;
}

/** Fired after the key is saved or removed, so every AI surface refreshes. */
export const KEY_CHANGED_EVENT = 'ow-ai-key-changed';
/** Ask the app to show the key settings (opens the chat panel on its key form). */
export const OPEN_KEY_SETTINGS_EVENT = 'ow-open-ai-key-settings';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `Request failed (${res.status})`), { code: body?.code, status: res.status });
  return body as T;
}

export async function getAiStatus(): Promise<AiStatus> {
  return json(await fetch('/api/ai/status'));
}

export async function saveAnthropicKey(key: string): Promise<KeyState> {
  const r = await json<{ key: KeyState }>(await fetch('/api/ai/key', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
  }));
  window.dispatchEvent(new CustomEvent(KEY_CHANGED_EVENT));
  return r.key;
}

export async function removeAnthropicKey(): Promise<KeyState> {
  const r = await json<{ key: KeyState }>(await fetch('/api/ai/key', { method: 'DELETE' }));
  window.dispatchEvent(new CustomEvent(KEY_CHANGED_EVENT));
  return r.key;
}

export async function inlineEdit(body: {
  docId: string; nodeIds: string[]; nodes: any[]; contextBefore: string[]; contextAfter: string[];
  instruction?: string; model: ModelChoice;
}): Promise<{ applied: number; model: ModelChoice }> {
  return json(await fetch('/api/ai/inline-edit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

// ---- Chat ----

export type ChatItem =
  | { kind: 'user'; text: string; at: string }
  | { kind: 'assistant'; text: string; at: string }
  | { kind: 'tool'; tool: string; summary: string; status: 'done' | 'failed' | 'denied' | 'cancelled'; at: string }
  | { kind: 'changes'; filename: string; title?: string; count: number; at: string }
  | { kind: 'error'; text: string; at: string };

export interface Chat {
  id: string;
  docId: string | null;
  model: ModelChoice;
  createdAt: string;
  updatedAt: string;
  items: ChatItem[];
}

export type ChatEvent =
  | { type: 'start'; chatId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; tool: string; summary: string; status: 'running' | 'done' | 'failed' | 'denied' | 'cancelled' }
  | { type: 'changes'; filename: string; count: number }
  | { type: 'confirm'; requestId: string; tool: string; summary: string }
  | { type: 'done'; stopped?: boolean }
  | { type: 'error'; message: string };

export async function listChats(docId: string | null): Promise<Array<{ id: string; updatedAt: string; preview: string }>> {
  const r = await json<{ chats: Array<{ id: string; updatedAt: string; preview: string }> }>(
    await fetch(`/api/ai/chats${docId ? `?docId=${encodeURIComponent(docId)}` : ''}`));
  return r.chats;
}

export async function getChat(id: string): Promise<{ chat: Chat; running: boolean }> {
  return json(await fetch(`/api/ai/chats/${encodeURIComponent(id)}`));
}

/** Send a message and read the answer as it streams. Resolves when the turn ends. */
export async function sendChatMessage(
  body: { chatId?: string; docId?: string | null; docTitle?: string; message: string; model: ModelChoice },
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  const res = await fetch('/api/ai/chats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    onEvent({ type: 'error', message: err?.error || `The chat failed (${res.status}).` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) { try { onEvent(JSON.parse(line)); } catch { /* skip a torn line */ } }
    }
  }
}

export async function stopChat(chatId: string): Promise<void> {
  await fetch(`/api/ai/chats/${encodeURIComponent(chatId)}/stop`, { method: 'POST' });
}

export async function answerConfirm(chatId: string, requestId: string, allow: boolean): Promise<void> {
  await fetch(`/api/ai/chats/${encodeURIComponent(chatId)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, allow }),
  });
}

// ---- Remembered model picks (per browser) ----

const MODEL_KEYS = { rewrite: 'ow-ai-rewrite-model', chat: 'ow-ai-chat-model' } as const;

export function rememberedModel(kind: keyof typeof MODEL_KEYS, fallback: ModelChoice): ModelChoice {
  try {
    const v = localStorage.getItem(MODEL_KEYS[kind]);
    return v === 'opus' || v === 'sonnet' || v === 'haiku' ? v : fallback;
  } catch { return fallback; }
}

export function rememberModel(kind: keyof typeof MODEL_KEYS, model: ModelChoice): void {
  try { localStorage.setItem(MODEL_KEYS[kind], model); } catch { /* private window */ }
}

export const MODEL_LABELS: Record<ModelChoice, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
