/**
 * Chat history, one conversation per file in `<profile>/_chats/<chatId>.json`.
 * A conversation belongs to the document it was started on: opening the chat
 * on a document shows that document's latest conversation. The agent's own
 * transcript (what it resumes from) lives with the Agent SDK session; this file
 * is what the panel shows. adr: adr/writer-key-ai.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getDataDir, atomicWriteFileSync } from '../helpers.js';

export type ChatItem =
  | { kind: 'user'; text: string; at: string }
  | { kind: 'assistant'; text: string; at: string }
  | { kind: 'tool'; tool: string; summary: string; status: 'done' | 'failed' | 'denied' | 'cancelled'; at: string }
  | { kind: 'changes'; filename: string; title?: string; count: number; at: string }
  | { kind: 'error'; text: string; at: string };

export interface Chat {
  id: string;
  docId: string | null;
  model: string;
  /** The Agent SDK session this conversation resumes. */
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  items: ChatItem[];
}

const CHAT_ID = /^[a-f0-9-]{8,64}$/;

function chatsDir(): string {
  return join(getDataDir(), '_chats');
}

export function isChatId(id: unknown): id is string {
  return typeof id === 'string' && CHAT_ID.test(id);
}

export function newChat(docId: string | null, model: string): Chat {
  const now = new Date().toISOString();
  return { id: randomUUID(), docId, model, createdAt: now, updatedAt: now, items: [] };
}

export function getChat(id: string): Chat | null {
  if (!isChatId(id)) return null;
  const p = join(chatsDir(), `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

export function saveChat(chat: Chat): void {
  mkdirSync(chatsDir(), { recursive: true });
  chat.updatedAt = new Date().toISOString();
  atomicWriteFileSync(join(chatsDir(), `${chat.id}.json`), JSON.stringify(chat));
}

/** Conversations for a document, newest first (null docId = started with no document open). */
export function listChats(docId: string | null): Array<Pick<Chat, 'id' | 'docId' | 'model' | 'createdAt' | 'updatedAt'> & { preview: string }> {
  if (!existsSync(chatsDir())) return [];
  const out: Array<Pick<Chat, 'id' | 'docId' | 'model' | 'createdAt' | 'updatedAt'> & { preview: string }> = [];
  for (const f of readdirSync(chatsDir())) {
    if (!f.endsWith('.json')) continue;
    const chat = getChat(f.slice(0, -5));
    if (!chat || chat.docId !== docId) continue;
    const first = chat.items.find((i) => i.kind === 'user') as { text: string } | undefined;
    out.push({ id: chat.id, docId: chat.docId, model: chat.model, createdAt: chat.createdAt, updatedAt: chat.updatedAt, preview: (first?.text ?? '').slice(0, 80) });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
