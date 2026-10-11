/**
 * The chat agent (server/ai/chat-runner.ts) with the Agent SDK's query() stood
 * in for. The stand-in plays the agent: it reads the options the runner passes,
 * asks the runner's permission check, and calls tools on the runner's
 * in-process MCP server the way the SDK would.
 *
 * Proves: all built-in tools off; only OpenWriter's tools reach the agent;
 * the writer's key goes only into the SDK process env (never process.env, never
 * next to the gateway or key-store secrets); risky tools wait for the writer's
 * confirm or cancel; an edit shows up as "N changes proposed"; the run stops if
 * the SDK reports another credential or extra tools; usage is logged.
 *
 * No Anthropic call, no Claude Code process. Throwaway data folder (hosted mode,
 * OW_DATA_DIR in the temp dir), never ~/.openwriter. adr: adr/writer-key-ai.md
 *
 * Run: `node scripts/test-ai-chat.mjs` (after `npm run build`)
 */

import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-ai-chat-test-'));
process.env.OW_HOSTED = '1';
process.env.OW_DATA_DIR = dataDir;
process.env.OW_GATEWAY_SECRET = 'gateway-secret-xyz';
process.env.OW_PUBLIC_URL = 'https://app.openwriter.io';
process.env.OW_KEY_SECRET = 'key-store-secret-xyz';
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const FAKE_KEY = 'sk-ant-api03-' + 'ChatT3stNotReal_'.repeat(4) + 'Ab12';

const { ensureDataDir } = await import('../dist/server/helpers.js');
ensureDataDir();
const { createAiRouter } = await import('../dist/server/ai/ai-routes.js');
const { saveKey } = await import('../dist/server/ai/key-store.js');
const { decideTool, needsConfirmation, CHAT_EXCLUDED_TOOLS } = await import('../dist/server/ai/chat-policy.js');
const { createDocumentFromRequest } = await import('../dist/server/document-create.js');
const { getDocument, getDocId, cancelDebouncedSave } = await import('../dist/server/state.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

// ---- Policy ----
console.log('\nPolicy:');
assert(decideTool('Bash', true) === 'deny' && decideTool('Read', true) === 'deny' && decideTool('WebFetch', true) === 'deny', 'built-in tools are denied');
assert(decideTool('mcp__other__write_to_pad', true) === 'deny', 'another MCP server\'s tools are denied');
assert(decideTool('mcp__openwriter__write_to_pad', false) === 'deny', 'a tool not from our in-process server is denied, whatever its name');
assert(decideTool('mcp__openwriter__read_pad', true) === 'allow', 'reading is allowed');
for (const t of ['delete_document', 'delete_workspace', 'restore_version', 'publish_to_site', 'unpublish_site_post', 'send_newsletter', 'resend_to_unopened', 'post_to_x', 'post_to_blog', 'schedule_post', 'manage_schedule']) {
  assert(needsConfirmation(t), `${t} needs the writer's confirmation`);
}
for (const t of ['write_to_pad', 'edit_text', 'create_document', 'archive_document']) assert(!needsConfirmation(t), `${t} runs without asking`);
assert(decideTool('mcp__openwriter__verify_login', true) === 'deny' && CHAT_EXCLUDED_TOOLS.has('claim_enrichment'), 'account and background tools are left out');

// ---- A chat turn through HTTP with a stand-in SDK ----
saveKey(FAKE_KEY);
createDocumentFromRequest({ title: 'Chat test', content: 'One plain paragraph.' });
const docId = getDocId();
const nodeId = getDocument().content[0].attrs.id;

let script = null; // what the stand-in agent does this turn
let seenOptions = null;
function fakeQuery({ prompt, options }) {
  seenOptions = options;
  return (async function* () {
    yield* script({ prompt, options });
  })();
}
async function mcpClientFor(options) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await options.mcpServers.openwriter.instance.connect(serverSide);
  const client = new Client({ name: 'stand-in', version: '1' });
  await client.connect(clientSide);
  return client;
}
const ours = { mcpServer: { name: 'openwriter', source: 'sdk' } };
const init = (extra = {}) => ({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY', tools: ['mcp__openwriter__read_pad', 'mcp__openwriter__write_to_pad'], session_id: 'sess-1', ...extra });
const result = { type: 'result', subtype: 'success', total_cost_usd: 0.0123, usage: {}, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 5000, outputTokens: 300, cacheReadInputTokens: 4000, cacheCreationInputTokens: 1000, costUSD: 0.0123 } } };

const app = express();
app.use(express.json());
app.use(createAiRouter({ chat: { query: fakeQuery } }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

/** Send a message; read the NDJSON stream; answer confirm cards with `confirmAnswer`. */
async function send(body, confirmAnswer = false, onStart = null) {
  const res = await fetch(`${base}/api/ai/chats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const events = [];
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const ev = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      events.push(ev);
      if (ev.type === 'start') { events.chatId = ev.chatId; if (onStart) events.stopAnswer = await onStart(ev.chatId); }
      if (ev.type === 'confirm') {
        await fetch(`${base}/api/ai/chats/${events.chatId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: ev.requestId, allow: confirmAnswer }) });
      }
    }
  }
  return events;
}

console.log('\nOne turn:');
const decisions = {};
script = async function* ({ prompt, options }) {
  yield init();
  decisions.bash = await options.canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal });
  decisions.read = await options.canUseTool('mcp__openwriter__read_pad', { docId }, { signal: new AbortController().signal, ...ours });
  decisions.del = await options.canUseTool('mcp__openwriter__delete_document', { docId }, { signal: new AbortController().signal, ...ours });
  decisions.prompt = prompt;
  const client = await mcpClientFor(options);
  decisions.toolNames = (await client.listTools()).tools.map((t) => t.name);
  await client.callTool({ name: 'write_to_pad', arguments: { docId, changes: [{ operation: 'rewrite', nodeId, content: 'One livelier paragraph.' }] } });
  await client.close();
  yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I tightened ' } } };
  yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'the paragraph.' } } };
  yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'I tightened the paragraph.' }] } };
  yield result;
};
const events = await send({ docId, docTitle: 'Chat test', message: 'Make it livelier', model: 'sonnet' }, false);
const types = events.map((e) => e.type);

assert(Array.isArray(seenOptions.tools) && seenOptions.tools.length === 0, 'every built-in tool is off (tools: [])');
assert(seenOptions.permissionMode === 'default' && typeof seenOptions.canUseTool === 'function', 'permission checks go through the runner');
assert(Array.isArray(seenOptions.settingSources) && seenOptions.settingSources.length === 0, 'no settings, CLAUDE.md or skills from disk');
assert(Object.keys(seenOptions.mcpServers).join() === 'openwriter', 'one MCP server: OpenWriter\'s, in-process');
assert(seenOptions.model === 'claude-sonnet-5-5', 'the chosen model is used');
assert(seenOptions.systemPrompt.includes('chat box') && seenOptions.systemPrompt.includes('# OpenWriter Skill'), 'system prompt: chat rules plus OpenWriter\'s own skill');

assert(seenOptions.env.ANTHROPIC_API_KEY === FAKE_KEY, 'the writer\'s key goes to the SDK process');
assert(!Object.values(process.env).some((v) => v && v.includes(FAKE_KEY)), 'the key never enters process.env');
const envText = JSON.stringify(seenOptions.env);
assert(!envText.includes('gateway-secret-xyz') && !envText.includes('key-store-secret-xyz'), 'the SDK process does not get the gateway or key-store secret');
assert(seenOptions.env.CLAUDE_CONFIG_DIR.startsWith(dataDir), 'the SDK keeps its config in the data folder, not ~/.claude');

assert(decisions.bash.behavior === 'deny', 'Bash asked for: denied');
assert(decisions.read.behavior === 'allow', 'read_pad: allowed without asking');
assert(decisions.del.behavior === 'deny' && events.some((e) => e.type === 'confirm' && e.tool === 'delete_document'), 'delete_document: paused for the writer, who cancelled');
assert(events.some((e) => e.type === 'tool' && e.tool === 'delete_document' && e.status === 'cancelled'), 'the cancel shows in the chat');
assert(decisions.prompt.includes(docId), 'the agent is told which document is open');
assert(decisions.toolNames.includes('write_to_pad') && !decisions.toolNames.includes('verify_login') && !decisions.toolNames.includes('claim_enrichment'), 'the agent sees OpenWriter\'s chat tools only');

const changes = events.find((e) => e.type === 'changes');
assert(changes && changes.count >= 1 && changes.filename.endsWith('.md'), '"N changes proposed" reported after the edit');
assert(getDocument().content[0].attrs.pendingStatus === 'rewrite', 'the agent\'s edit is a pending change');
assert(events.filter((e) => e.type === 'text').map((e) => e.delta).join('') === 'I tightened the paragraph.', 'the reply streams');
assert(types.at(-1) === 'done', 'the turn ends with done');

const chatId = events.chatId;
const saved = await (await fetch(`${base}/api/ai/chats/${chatId}`)).json();
assert(saved.chat.docId === docId && saved.chat.sessionId === 'sess-1', 'the conversation is kept for this document, with its SDK session');
assert(saved.chat.items.some((i) => i.kind === 'assistant' && i.text === 'I tightened the paragraph.') && saved.chat.items.some((i) => i.kind === 'changes'), 'history holds the reply and the changes');
const list = await (await fetch(`${base}/api/ai/chats?docId=${docId}`)).json();
assert(list.chats.length === 1 && list.chats[0].id === chatId, 'the document\'s chat list shows it');

const usage = readFileSync(join(dataDir, 'ai', 'usage.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
const turn = usage.find((u) => u.kind === 'chat');
assert(turn && turn.toolCalls === 1 && turn.inputTokens === 5000 && turn.cacheReadTokens === 4000 && turn.costUsd === 0.0123, 'chat usage logged: tokens, tool calls, cost');

console.log('\nNext turn resumes; confirm allowed:');
script = async function* ({ options }) {
  decisions.resume = options.resume;
  yield init();
  decisions.restore = await options.canUseTool('mcp__openwriter__restore_version', { docId }, { signal: new AbortController().signal, ...ours });
  yield result;
};
await send({ chatId, docId, message: 'Restore the old version' }, true);
assert(decisions.resume === 'sess-1', 'the next message resumes the same SDK session');
assert(decisions.restore.behavior === 'allow', 'restore_version: runs after the writer confirms');

console.log('\nGuards:');
script = async function* () { yield init({ apiKeySource: 'none' }); yield result; };
let guarded = await send({ docId, message: 'hi' });
assert(guarded.some((e) => e.type === 'error' && /own Anthropic API key/.test(e.message)), 'a run not on the writer\'s key (e.g. a claude.ai login) is stopped');
script = async function* () { yield init({ tools: ['Bash', 'mcp__openwriter__read_pad'] }); yield result; };
guarded = await send({ docId, message: 'hi' });
assert(guarded.some((e) => e.type === 'error' && /other than OpenWriter/.test(e.message)), 'a run offered a built-in tool is stopped');

console.log('\nStop:');
script = async function* ({ options }) {
  yield init();
  await new Promise((resolve) => options.abortController.signal.addEventListener('abort', resolve, { once: true }));
  throw new Error('aborted');
};
// The browser stops the chat named by the stream's start event.
const stopped = await send({ docId, message: 'long job' }, false,
  async (id) => (await fetch(`${base}/api/ai/chats/${id}/stop`, { method: 'POST' })).json());
assert(stopped.stopAnswer?.stopped === true && stopped.some((e) => e.type === 'done' && e.stopped), 'stop ends the running answer');

console.log('\nNo key:');
const { removeKey } = await import('../dist/server/ai/key-store.js');
removeKey();
const nokey = await send({ docId, message: 'hi' });
assert(nokey.some((e) => e.type === 'error' && /Add your Anthropic API key/.test(e.message)), 'without a key the chat asks for one');

cancelDebouncedSave();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
