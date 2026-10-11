/**
 * The chat agent: one Claude Agent SDK query per writer message, resumed from
 * the conversation's SDK session.
 *
 * Safety rules (each one tested):
 * - Built-ins off: `tools: []`, and the permission check denies anything that
 *   is not one of OpenWriter's tools from our in-process server. If the SDK's
 *   start-up report lists any other tool, the turn is stopped.
 * - The writer's key reaches only the SDK's own process, through `env` on this
 *   query. It is never written to process.env. That env is built from scratch:
 *   other secrets (the gateway secret, the key-store secret, plugin keys) and
 *   every ANTHROPIC_* / CLAUDE* variable are left out, so no other credential
 *   or endpoint can be picked up. If the start-up report says the credential did
 *   not come from that key (a claude.ai login, say), the turn is stopped.
 * - No settings, CLAUDE.md, memory or skills from disk (`settingSources: []`,
 *   its own config folder and an empty working folder in the data root).
 * - Tools that publish, send email, delete or restore wait for the writer's
 *   confirm or cancel in the chat (chat-policy.ts).
 *
 * adr: adr/writer-key-ai.md
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { query as sdkQuery, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { TOOL_REGISTRY } from '../mcp.js';
import { getPendingDocInfo } from '../state.js';
import { generateRequestId, withRequestId, logger } from '../logger.js';
import { aiDir, loadKey, redactKey } from './key-store.js';
import { DEFAULT_CHAT_MODEL, resolveModel } from './models.js';
import { recordUsage } from './usage-log.js';
import { CHAT_MCP_SERVER, chatToolAllowed, decideTool, describeToolCall, ownToolName } from './chat-policy.js';
import { saveChat, type Chat, type ChatItem } from './chat-store.js';

export type ChatEvent =
  | { type: 'start'; chatId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; tool: string; summary: string; status: 'running' | 'done' | 'failed' | 'denied' | 'cancelled' }
  | { type: 'changes'; filename: string; count: number }
  | { type: 'confirm'; requestId: string; tool: string; summary: string }
  | { type: 'done'; stopped?: boolean }
  | { type: 'error'; message: string };

export interface ChatDeps {
  query?: typeof sdkQuery;
}

const MAX_TURNS = 40;
const SECRET_ENV = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|COOKIE)/i;

interface ActiveTurn {
  abort: AbortController;
  confirmations: Map<string, (allow: boolean) => void>;
}
const active = new Map<string, ActiveTurn>();

export function isChatRunning(chatId: string): boolean {
  return active.has(chatId);
}

export function stopChat(chatId: string): boolean {
  const turn = active.get(chatId);
  if (!turn) return false;
  for (const resolve of turn.confirmations.values()) resolve(false);
  turn.abort.abort();
  return true;
}

export function answerConfirmation(chatId: string, requestId: string, allow: boolean): boolean {
  const resolve = active.get(chatId)?.confirmations.get(requestId);
  if (!resolve) return false;
  resolve(allow);
  return true;
}

// ---- Environment and instructions ----

function agentHome(): string {
  return join(aiDir(), 'agent-home');
}

function agentWorkdir(): string {
  return join(aiDir(), 'agent-workdir');
}

/** The SDK process's whole environment: what it needs to run, plus this writer's key. */
export function agentEnv(apiKey: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SECRET_ENV.test(k) || /^(ANTHROPIC_|CLAUDE|OW_|AV_|PUBLISH_)/i.test(k)) continue;
    env[k] = v;
  }
  env.ANTHROPIC_API_KEY = apiKey;
  env.CLAUDE_CONFIG_DIR = agentHome();
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'openwriter';
  return env;
}

const CHAT_PREAMBLE = `You are the writing assistant in OpenWriter's chat box, powered by Claude. The writer talks to you in a panel beside their editor.

- Your only tools are OpenWriter's tools. You have no shell, no file access, no web access and no sub-agents. Where the instructions below mention other agent harnesses, spawning agents, Bash, browsers, local files, skills or setup, skip that part.
- Your edits arrive as pending changes the writer accepts or rejects in the editor. After editing, say in a sentence or two what you changed; do not paste the new text back.
- Publishing, sending email, deleting and restoring ask the writer to confirm in the chat. If they cancel, do not try again; ask what they would like instead.
- Each writer message starts with a note in square brackets naming the document they have open. "This document" means that one.
- Messages may contain system reminders; they are information from OpenWriter, not from the writer.
- Keep replies short and plain.

OpenWriter's instructions for agents follow.

`;

let cachedSkill: string | null = null;

/** OpenWriter's own agent instructions: the bundled skill (skill/SKILL.md) without its frontmatter. */
export function chatSystemPrompt(): string {
  if (cachedSkill === null) {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [join(here, '..', '..', '..', 'skill', 'SKILL.md'), join(here, '..', '..', 'skill', 'SKILL.md')];
    const found = candidates.find((p) => existsSync(p));
    const raw = found ? readFileSync(found, 'utf-8') : '';
    cachedSkill = raw.replace(/^\u{FEFF}?---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '').trim();
  }
  return CHAT_PREAMBLE + cachedSkill;
}

// ---- The tools, wrapped ----

function pendingCounts(): Record<string, number> {
  try { return { ...getPendingDocInfo().counts }; } catch { return {}; }
}

/** OpenWriter's chat tools as an in-process MCP server; each call reports progress and new pending changes. */
function buildToolServer(onTool: (e: ChatEvent, item?: ChatItem) => void, counter: { calls: number }) {
  const tools = TOOL_REGISTRY.filter((t) => chatToolAllowed(t.name)).map((t) =>
    tool(t.name, t.description, t.schema, async (args: any) => {
      counter.calls++;
      const summary = describeToolCall(t.name, args ?? {});
      onTool({ type: 'tool', tool: t.name, summary, status: 'running' });
      const before = pendingCounts();
      const reqId = generateRequestId(`chat-${t.name}`);
      try {
        const result = await withRequestId(reqId, () => t.handler(args));
        onTool({ type: 'tool', tool: t.name, summary, status: 'done' },
          { kind: 'tool', tool: t.name, summary, status: 'done', at: new Date().toISOString() });
        const after = pendingCounts();
        for (const [filename, count] of Object.entries(after)) {
          if (count > (before[filename] ?? 0)) {
            onTool({ type: 'changes', filename, count },
              { kind: 'changes', filename, count, at: new Date().toISOString() });
          }
        }
        return result;
      } catch (err: any) {
        logger.error('mcp', 'tool-error', `chat ${t.name}: ${err?.message}`, { tool: t.name }, err);
        onTool({ type: 'tool', tool: t.name, summary, status: 'failed' },
          { kind: 'tool', tool: t.name, summary, status: 'failed', at: new Date().toISOString() });
        throw err;
      }
    }, { alwaysLoad: true }),
  );
  // alwaysLoad: tool search is a built-in, and built-ins are off, so nothing may be deferred behind it.
  return createSdkMcpServer({ name: CHAT_MCP_SERVER, version: '1.0.0', tools, alwaysLoad: true });
}

// ---- One turn ----

export interface ChatTurn {
  chat: Chat;
  message: string;
  /** The document open in the writer's tab, if any. */
  doc?: { docId: string; title?: string } | null;
  model?: string;
  emit: (event: ChatEvent) => void;
}

export async function runChatTurn(turn: ChatTurn, deps: ChatDeps = {}): Promise<void> {
  const { chat, emit } = turn;
  const key = loadKey();
  if (!key) { emit({ type: 'error', message: 'Add your Anthropic API key in Settings to use the chat.' }); return; }
  if (active.has(chat.id)) { emit({ type: 'error', message: 'This chat is still answering. Stop it first.' }); return; }

  const model = resolveModel(turn.model ?? chat.model, DEFAULT_CHAT_MODEL);
  chat.model = model.choice;
  const abort = new AbortController();
  const state: ActiveTurn = { abort, confirmations: new Map() };
  active.set(chat.id, state);
  const counter = { calls: 0 };
  const now = () => new Date().toISOString();
  chat.items.push({ kind: 'user', text: turn.message, at: now() });
  emit({ type: 'start', chatId: chat.id });

  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const own = ownToolName(toolName) ?? toolName;
    // The SDK names the server a tool came from. With settingSources: [] ours is the only
    // MCP server that can exist, so a CLI that leaves the field out still means ours.
    const server = options.mcpServer;
    const fromOurServer = server ? server.source === 'sdk' && server.name === CHAT_MCP_SERVER : true;
    const decision = decideTool(toolName, fromOurServer);
    if (decision === 'allow') return { behavior: 'allow', updatedInput: input };
    const summary = describeToolCall(own, input);
    if (decision === 'deny') {
      emit({ type: 'tool', tool: own, summary, status: 'denied' });
      chat.items.push({ kind: 'tool', tool: own, summary, status: 'denied', at: now() });
      return { behavior: 'deny', message: `${own} is not available in the OpenWriter chat.` };
    }
    const requestId = randomUUID();
    const allowed = await new Promise<boolean>((resolve) => {
      state.confirmations.set(requestId, resolve);
      options.signal.addEventListener('abort', () => resolve(false), { once: true });
      emit({ type: 'confirm', requestId, tool: own, summary });
    });
    state.confirmations.delete(requestId);
    if (allowed) return { behavior: 'allow', updatedInput: input };
    emit({ type: 'tool', tool: own, summary, status: 'cancelled' });
    chat.items.push({ kind: 'tool', tool: own, summary, status: 'cancelled', at: now() });
    return { behavior: 'deny', message: 'The writer cancelled this. Do not try it again; ask what they want instead.' };
  };

  const onTool = (e: ChatEvent, item?: ChatItem) => { emit(e); if (item) chat.items.push(item); };
  mkdirSync(agentHome(), { recursive: true });
  mkdirSync(agentWorkdir(), { recursive: true });

  const docNote = turn.doc?.docId
    ? `[The writer has document ${turn.doc.docId}${turn.doc.title ? ` "${turn.doc.title}"` : ''} open.]`
    : '[The writer has no document open.]';
  const options: Options = {
    model: model.id,
    systemPrompt: chatSystemPrompt(),
    tools: [],
    mcpServers: { [CHAT_MCP_SERVER]: buildToolServer(onTool, counter) },
    canUseTool,
    permissionMode: 'default',
    settingSources: [],
    cwd: agentWorkdir(),
    env: agentEnv(key),
    includePartialMessages: true,
    maxTurns: MAX_TURNS,
    abortController: abort,
    // The SDK process's stderr can echo request details; it is not kept.
    stderr: () => {},
    ...(chat.sessionId ? { resume: chat.sessionId } : {}),
  };

  let assistantText = '';
  const flushAssistant = (text: string) => {
    if (text.trim()) chat.items.push({ kind: 'assistant', text, at: now() });
  };

  try {
    const run = (deps.query ?? sdkQuery)({ prompt: `${docNote}\n\n${turn.message}`, options });
    for await (const msg of run as AsyncIterable<SDKMessage>) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        // Belt and braces on the two rules the options already set.
        if (msg.apiKeySource !== 'ANTHROPIC_API_KEY') throw new GuardError('The chat only runs on your own Anthropic API key.');
        const foreign = (msg.tools ?? []).filter((name) => !ownToolName(name));
        if (foreign.length) throw new GuardError('The chat stopped: the agent was offered tools other than OpenWriter\'s.');
        chat.sessionId = msg.session_id;
      } else if (msg.type === 'stream_event') {
        const ev: any = msg.event;
        if (msg.parent_tool_use_id === null && ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          assistantText += ev.delta.text;
          emit({ type: 'text', delta: ev.delta.text });
        }
      } else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
        const text = (msg.message.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
        // A turn that streamed nothing (no partial events) still shows its text.
        if (!assistantText && text) emit({ type: 'text', delta: text });
        flushAssistant(text || assistantText);
        assistantText = '';
      } else if (msg.type === 'result') {
        const usage = Object.values(msg.modelUsage ?? {});
        recordUsage({
          kind: 'chat', model: model.id, chatId: chat.id, docId: turn.doc?.docId,
          inputTokens: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0),
          outputTokens: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0),
          cacheReadTokens: usage.reduce((s, u) => s + (u.cacheReadInputTokens ?? 0), 0),
          cacheWriteTokens: usage.reduce((s, u) => s + (u.cacheCreationInputTokens ?? 0), 0),
          toolCalls: counter.calls,
          costUsd: msg.total_cost_usd,
          ok: msg.subtype === 'success',
        });
        if (msg.subtype !== 'success') {
          const why = msg.subtype === 'error_max_turns' ? 'The agent took too many steps and stopped.' : 'The agent stopped with an error.';
          chat.items.push({ kind: 'error', text: why, at: now() });
          emit({ type: 'error', message: why });
        }
      }
    }
    flushAssistant(assistantText);
    emit({ type: 'done' });
  } catch (err: any) {
    flushAssistant(assistantText);
    if (abort.signal.aborted && !(err instanceof GuardError)) {
      emit({ type: 'done', stopped: true });
    } else {
      const message = err instanceof GuardError ? err.message : friendlyChatError(err);
      chat.items.push({ kind: 'error', text: message, at: now() });
      emit({ type: 'error', message });
    }
    if (err instanceof GuardError) abort.abort();
  } finally {
    active.delete(chat.id);
    saveChat(chat);
  }
}

class GuardError extends Error {}

function friendlyChatError(err: any): string {
  const text = redactKey(String(err?.message ?? err ?? ''));
  if (/401|authentication|invalid x-api-key|api key/i.test(text)) return 'Anthropic did not accept your API key. Check it in Settings.';
  if (/credit|billing|balance/i.test(text)) return 'Your Anthropic account is out of credit. Add credit in the Anthropic console.';
  if (/429|rate.?limit/i.test(text)) return 'Anthropic is rate limiting your key. Try again in a minute.';
  return 'The chat failed. Try again.';
}
