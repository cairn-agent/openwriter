/**
 * The chat panel's state, kept outside React: the rail unmounts a tab when the
 * writer switches tabs (to Review, say), and a streaming answer must survive
 * that. One conversation is shown at a time: the open document's latest one,
 * until the writer starts a new chat. A running answer keeps its conversation
 * on screen even if the writer opens another document.
 */
import { useSyncExternalStore } from 'react';
import {
  answerConfirm, getChat, listChats, rememberedModel, rememberModel, sendChatMessage, stopChat,
  type ChatEvent, type ChatItem, type ModelChoice,
} from './ai-api';

export interface ChatSessionState {
  /** The document this conversation belongs to (null: no document open). */
  docId: string | null;
  chatId: string | null;
  items: ChatItem[];
  /** The answer text arriving right now, not yet an item. */
  streaming: string;
  running: boolean;
  /** The tool the agent is using right now, for the status line. */
  activity: string | null;
  confirm: { requestId: string; tool: string; summary: string } | null;
  model: ModelChoice;
  loading: boolean;
}

let state: ChatSessionState = {
  docId: null, chatId: null, items: [], streaming: '', running: false,
  activity: null, confirm: null, model: rememberedModel('chat', 'sonnet'), loading: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<ChatSessionState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChatSession(): ChatSessionState {
  return useSyncExternalStore(subscribe, () => state);
}

const now = () => new Date().toISOString();

/** Show the open document's latest conversation (no-op while an answer is running). */
export async function showChatFor(docId: string | null): Promise<void> {
  if (state.running || (docId === state.docId && (state.chatId || state.items.length))) return;
  set({ docId, chatId: null, items: [], streaming: '', confirm: null, activity: null, loading: true });
  try {
    const [latest] = await listChats(docId);
    if (latest && state.docId === docId && !state.running) {
      const { chat } = await getChat(latest.id);
      if (state.docId === docId && !state.running) set({ chatId: chat.id, items: chat.items });
    }
  } catch {
    // An empty panel is fine; sending still works.
  } finally {
    if (state.docId === docId) set({ loading: false });
  }
}

export function newChat(docId: string | null): void {
  if (state.running) return;
  set({ docId, chatId: null, items: [], streaming: '', confirm: null, activity: null });
}

export function setChatModel(model: ModelChoice): void {
  rememberModel('chat', model);
  set({ model });
}

function flushStreaming(): void {
  if (state.streaming.trim()) set({ items: [...state.items, { kind: 'assistant', text: state.streaming, at: now() }], streaming: '' });
  else if (state.streaming) set({ streaming: '' });
}

function onEvent(e: ChatEvent): void {
  switch (e.type) {
    case 'start': set({ chatId: e.chatId }); break;
    case 'text': set({ streaming: state.streaming + e.delta, activity: null }); break;
    case 'tool':
      if (e.status === 'running') { flushStreaming(); set({ activity: e.summary }); break; }
      set({ activity: null });
      if (e.status !== 'done') set({ items: [...state.items, { kind: 'tool', tool: e.tool, summary: e.summary, status: e.status, at: now() }] });
      break;
    case 'changes': set({ items: [...state.items, { kind: 'changes', filename: e.filename, count: e.count, at: now() }] }); break;
    case 'confirm': flushStreaming(); set({ confirm: { requestId: e.requestId, tool: e.tool, summary: e.summary } }); break;
    case 'error': flushStreaming(); set({ items: [...state.items, { kind: 'error', text: e.message, at: now() }] }); break;
    case 'done': flushStreaming(); break;
  }
}

export async function sendMessage(text: string, doc: { docId: string | null; title?: string }): Promise<void> {
  const message = text.trim();
  if (!message || state.running) return;
  set({
    running: true, streaming: '', confirm: null, activity: null,
    docId: state.chatId ? state.docId : doc.docId,
    items: [...state.items, { kind: 'user', text: message, at: now() }],
  });
  try {
    await sendChatMessage({
      chatId: state.chatId ?? undefined,
      docId: state.docId,
      docTitle: doc.docId === state.docId ? doc.title : undefined,
      message,
      model: state.model,
    }, onEvent);
  } catch {
    onEvent({ type: 'error', message: 'Lost the connection to the chat.' });
  } finally {
    flushStreaming();
    set({ running: false, activity: null, confirm: null });
  }
}

export async function stopAnswer(): Promise<void> {
  if (state.chatId && state.running) await stopChat(state.chatId);
}

export async function answer(allow: boolean): Promise<void> {
  const pending = state.confirm;
  if (!pending || !state.chatId) return;
  set({ confirm: null });
  await answerConfirm(state.chatId, pending.requestId, allow);
}
