/**
 * The writer's Anthropic key and inline edits.
 *
 *  - the key is stored on the server only, encrypted when the machine has
 *    OW_KEY_SECRET, never returned to the browser (last four characters at most),
 *    never logged, never put in process.env, and removable;
 *  - an inline rewrite calls Anthropic once with the writer's key and the result
 *    becomes a pending change in the document; the model choice maps to the ids
 *    in server/ai/models.ts; refusals and a rejected key leave the document alone;
 *  - usage is logged without text or key.
 *
 * Anthropic is never called: a stand-in client answers. Throwaway data folder
 * (hosted mode, OW_DATA_DIR in the temp dir), never ~/.openwriter.
 * adr: adr/writer-key-ai.md
 *
 * Run: `node scripts/test-ai-key-and-inline-edit.mjs` (after `npm run build`)
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-ai-key-test-'));
process.env.OW_HOSTED = '1';
process.env.OW_DATA_DIR = dataDir;
process.env.OW_GATEWAY_SECRET = 'test-secret';
process.env.OW_PUBLIC_URL = 'https://app.openwriter.io';
process.env.OW_KEY_SECRET = 'machine-secret-for-tests';
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const FAKE_KEY = 'sk-ant-api03-' + 'T3stKeyNotReal_'.repeat(4) + 'Zq9w';

// Capture every console line so we can prove the key never reaches a log.
const logged = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => { logged.push(args.map(String).join(' ')); orig(...args); };
}

const { ensureDataDir, getDataDir } = await import('../dist/server/helpers.js');
ensureDataDir();
const { createAiRouter } = await import('../dist/server/ai/ai-routes.js');
const { loadKey } = await import('../dist/server/ai/key-store.js');
const { MODELS } = await import('../dist/server/ai/models.js');
const { createDocumentFromRequest } = await import('../dist/server/document-create.js');
const { getDocument, getDocId, getPendingDocInfo, cancelDebouncedSave } = await import('../dist/server/state.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

// Stand-in for Anthropic: records each call, answers with the queued response.
const calls = [];
let nextResponse = null;
let nextError = null;
const fakeClient = (apiKey) => ({
  messages: {
    create: async (params) => {
      calls.push({ apiKey, params });
      if (nextError) { const e = nextError; nextError = null; throw e; }
      return nextResponse;
    },
  },
});
const reply = (text, stop = 'end_turn') => ({
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  stop_reason: stop,
  usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 },
});

const app = express();
app.use(express.json());
app.use(createAiRouter({ inlineClient: fakeClient }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

// ---- Key ----
console.log('\nKey settings:');
let r = await api('GET', '/api/ai/status');
assert(r.json.key.saved === false, 'no key at first');
assert(r.json.models.map((m) => m.choice).join() === 'opus,sonnet,haiku', 'three model choices offered');

r = await api('PUT', '/api/ai/key', { key: 'not-a-key' });
assert(r.status === 400, 'a malformed key is refused');

r = await api('PUT', '/api/ai/key', { key: FAKE_KEY });
assert(r.status === 200 && r.json.key.saved && r.json.key.last4 === FAKE_KEY.slice(-4), 'key saved; the answer names only the last four characters');
assert(!r.text.includes(FAKE_KEY) && !r.text.includes(FAKE_KEY.slice(0, 20)), 'the save answer does not contain the key');

r = await api('GET', '/api/ai/status');
assert(!r.text.includes(FAKE_KEY.slice(0, 20)), 'status never contains the key');

const keyFile = join(dataDir, 'ai', 'anthropic-key.json');
const onDisk = readFileSync(keyFile, 'utf-8');
assert(!onDisk.includes(FAKE_KEY) && JSON.parse(onDisk).data, 'with OW_KEY_SECRET the file holds only ciphertext');
assert(loadKey() === FAKE_KEY, 'the server can read the key back for a call');
assert(!Object.values(process.env).some((v) => v && v.includes(FAKE_KEY)), 'the key is not in process.env');

const savedSecret = process.env.OW_KEY_SECRET;
process.env.OW_KEY_SECRET = 'a-different-secret';
r = await api('GET', '/api/ai/status');
assert(r.json.key.saved === true && r.json.key.usable === false, 'a changed machine secret makes the key unusable, not readable');
process.env.OW_KEY_SECRET = savedSecret;

// ---- Inline edit ----
console.log('\nInline edit:');
createDocumentFromRequest({ title: 'Inline edit test', content: 'The first paragraph is quite plain.\n\nA second paragraph follows here.' });
const docId = getDocId();
const firstNode = () => getDocument().content.find((n) => n.type === 'paragraph');
const target = firstNode();
const body = (extra = {}) => ({
  docId,
  nodeIds: [target.attrs.id],
  nodes: [target],
  contextAfter: ['A second paragraph follows here.'],
  ...extra,
});

await api('DELETE', '/api/ai/key');
r = await api('POST', '/api/ai/inline-edit', body());
assert(r.status === 409 && r.json.code === 'no_key', 'without a key: "add your key" (409 no_key)');
assert(calls.length === 0, 'without a key Anthropic is not called');
await api('PUT', '/api/ai/key', { key: FAKE_KEY });

nextResponse = reply('The opening paragraph now reads with more life.');
r = await api('POST', '/api/ai/inline-edit', body({ model: 'sonnet' }));
assert(r.status === 200 && r.json.applied === 1, 'rewrite applied');
const call = calls.at(-1);
assert(call.apiKey === FAKE_KEY, 'the call used the writer\'s key');
assert(call.params.model === MODELS.sonnet.id && call.params.model === 'claude-sonnet-5-5', 'sonnet maps to claude-sonnet-5-5');
assert(call.params.output_config?.effort === 'low' && call.params.temperature === undefined, 'Sonnet: low effort, no temperature');
assert(/sharp human editor/.test(call.params.system[0].text), 'no voice profile: the clean-editor prompt');
assert(call.params.messages[0].content.includes('[[START_SELECTION]]'), 'the selection is marked for the model');
const after = firstNode();
assert(after.attrs.pendingStatus === 'rewrite', 'the rewrite is a pending change, not applied text');
assert((getPendingDocInfo().counts[Object.keys(getPendingDocInfo().counts)[0]] ?? 0) >= 1, 'the document shows pending changes');

// Voice profile from the Author's Voice skill files.
mkdirSync(join(getDataDir(), 'voice'), { recursive: true });
writeFileSync(join(getDataDir(), 'voice', 'anchor.md'), 'Hemingway 50%, Didion 50%');
writeFileSync(join(getDataDir(), 'voice', 'fingerprints.md'), '- Uses semicolons often');
nextResponse = reply('Another rewrite.');
r = await api('POST', '/api/ai/inline-edit', body({ model: 'haiku', instruction: 'make it punchier' }));
const voiced = calls.at(-1).params;
assert(voiced.model === 'claude-haiku-4-5-20251001' && voiced.output_config === undefined, 'haiku maps to claude-haiku-4-5-20251001 with no effort field');
assert(voiced.system[0].text.includes('Hemingway 50%, Didion 50%') && voiced.system[0].text.includes('Uses semicolons often'), 'the voice anchor and fingerprints reach the prompt');
assert(voiced.messages[0].content.includes('make it punchier'), 'the writer\'s instruction reaches the prompt');

nextResponse = reply('', 'refusal');
const beforeRefusal = JSON.stringify(getDocument());
r = await api('POST', '/api/ai/inline-edit', body({ model: 'opus' }));
assert(r.status === 422 && r.json.code === 'refused', 'a refusal is reported');
assert(calls.at(-1).params.model === 'claude-opus-5-5', 'opus maps to claude-opus-5-5');
assert(JSON.stringify(getDocument()) === beforeRefusal, 'a refusal leaves the document alone');

nextError = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${FAKE_KEY}` } }, `401 invalid x-api-key ${FAKE_KEY}`, new Headers());
r = await api('POST', '/api/ai/inline-edit', body());
assert(r.status === 401 && r.json.code === 'key_rejected' && !r.text.includes(FAKE_KEY), 'a rejected key is reported plainly, without the key');

// ---- Usage log ----
console.log('\nUsage log:');
const usage = readFileSync(join(dataDir, 'ai', 'usage.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
assert(usage.length >= 4 && usage.every((u) => u.kind === 'inline-edit'), 'each inline edit is logged');
const ok = usage.find((u) => u.ok);
assert(ok.inputTokens === 1200 && ok.outputTokens === 40 && ok.cacheWriteTokens === 900 && ok.toolCalls === 0, 'tokens recorded');
const usageText = readFileSync(join(dataDir, 'ai', 'usage.jsonl'), 'utf-8');
assert(!usageText.includes(FAKE_KEY) && !usageText.includes('paragraph'), 'the usage log holds no key and no text');

// ---- Never logged ----
console.log('\nKey never logged:');
const files = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
walk(dataDir);
const leaked = files.filter((p) => p !== keyFile && readFileSync(p, 'utf-8').includes(FAKE_KEY));
assert(leaked.length === 0, `no file but the key store holds the key${leaked.length ? ': ' + leaked.join(', ') : ''}`);
assert(!logged.some((l) => l.includes(FAKE_KEY)), 'no console line holds the key');

r = await api('DELETE', '/api/ai/key');
assert(r.json.key.saved === false && !existsSync(keyFile), 'the key can be removed');

cancelDebouncedSave();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
