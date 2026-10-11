/**
 * Phase 1 gaps closed in Phase 2:
 *  - hosted mode: a refused gateway signature answers 401 `signed_out`, and the
 *    browser's fetch wrapper sends only that answer to /_auth/signin;
 *  - the publish plugin saves its key and creates documents in-process, never by
 *    calling the server back over HTTP (a hosted server has no loopback port).
 *
 * Throwaway data folder (OW_DATA_DIR in the temp dir), never ~/.openwriter. The
 * publish API is mocked; nothing leaves the machine. adr: adr/hosted-gateway-trust.md
 *
 * Run: `node scripts/test-hosted-signin-and-plugin-host.mjs` (after `npm run build`)
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'ow-signin-host-test-'));
process.env.OW_HOSTED = '1';
process.env.OW_DATA_DIR = dataDir;
process.env.OW_GATEWAY_SECRET = 'test-secret';
process.env.OW_PUBLIC_URL = 'https://app.openwriter.io';
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

// The publish plugin reads its key from config.json; a fake one, so platformFetch runs.
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  plugins: { '@openwriter/plugin-publish': { enabled: true, config: { 'api-key': 'ow_live_fake' } } },
}));
mkdirSync(join(dataDir, 'profiles', 'Default'), { recursive: true });

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

// ---- Server: the refusal body ----
console.log('\nHosted 401 body:');
const { securityGate } = await import('../dist/server/security-gate.js');
function runGate(headers) {
  let status = 0;
  let body = null;
  const res = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
  };
  let nexted = false;
  securityGate(8080)({ method: 'GET', headers }, res, () => { nexted = true; });
  return { status, body, nexted };
}
const unsigned = runGate({});
assert(unsigned.status === 401 && unsigned.body?.error === 'signed_out', 'unsigned request: 401 signed_out');
assert(!unsigned.nexted, 'unsigned request never reaches a route');

// ---- Client: the fetch wrapper ----
console.log('\nBrowser redirect:');
const src = readFileSync(join(here, '..', 'src', 'utils', 'signed-out.ts'), 'utf-8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const clientDir = mkdtempSync(join(tmpdir(), 'ow-signed-out-'));
writeFileSync(join(clientDir, 'signed-out.mjs'), js);
const { installSignedOutRedirect } = await import(pathToFileURL(join(clientDir, 'signed-out.mjs')).href);
rmSync(clientDir, { recursive: true, force: true });

function fakeWindow(respond) {
  const assigned = [];
  const win = {
    location: { href: 'https://app.openwriter.io/d/abc', origin: 'https://app.openwriter.io', assign: (u) => assigned.push(u) },
    fetch: async (input) => respond(String(input)),
  };
  globalThis.window = win;
  installSignedOutRedirect(win);
  return { win, assigned };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

{
  const { win, assigned } = fakeWindow(() => json(401, { error: 'signed_out' }));
  const res = await win.fetch('/api/documents');
  assert(assigned.length === 1 && assigned[0] === '/_auth/signin', '401 signed_out on a same-origin call goes to /_auth/signin');
  assert((await res.json()).error === 'signed_out', 'the caller still gets the response body');
}
{
  const { win, assigned } = fakeWindow(() => json(401, { error: 'Not authenticated' }));
  await win.fetch('/api/publications');
  assert(assigned.length === 0, 'an ordinary 401 (publish not connected) does not redirect');
}
{
  const { win, assigned } = fakeWindow(() => json(401, { error: 'signed_out' }));
  await win.fetch('https://elsewhere.example/api');
  assert(assigned.length === 0, 'another origin answering signed_out does not redirect');
}
{
  const { win, assigned } = fakeWindow(() => json(200, { ok: true }));
  await win.fetch('/api/status');
  assert(assigned.length === 0, '200 does not redirect');
}

// ---- Publish plugin: in-process host calls ----
console.log('\nPublish plugin calls the host in-process:');
const fetched = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  fetched.push(u);
  if (u.endsWith('/auth/verify-code')) return json(200, { apiKey: 'ow_live_new', userId: 'user-1' });
  if (u.endsWith('/transforms')) return json(200, { success: true, html: '<p>Shorter text.</p>', newTitle: 'Short', metadata: {} });
  return json(404, { error: 'unexpected' });
};

const { default: publish } = await import(pathToFileURL(join(here, '..', '..', '..', 'plugins', 'publish', 'dist', 'index.js')).href);
const saved = [];
const created = [];
const host = {
  saveConfig: (values) => { saved.push(values); return { success: true }; },
  createDocument: (body, tab) => { created.push({ body, tab }); return { filename: 'short.md', title: body.title }; },
};

const tools = publish.mcpTools({}, host);
const verify = tools.find((t) => t.name === 'verify_login');
const result = await verify.handler({ email: 'w@example.com', code: '123456' });
assert(saved.length === 1 && saved[0]['api-key'] === 'ow_live_new', 'verify_login saves the key through host.saveConfig');
assert(result.success === true && !('apiKey' in result), 'verify_login reports success without echoing the key');

const routes = {};
publish.registerRoutes({ app: { post: (p, h) => { routes[p] = h; }, get() {} }, config: {}, dataDir, configFile: '', host });
let sent = null;
const res = { status(s) { this.code = s; return this; }, json(b) { sent = b; return this; } };
await routes['/api/publish/sidebar-action']({ body: { action: 'shrinkify', filename: 'long.md', title: 'Long', content: 'One two three.' } }, res);
assert(created.length === 1 && created[0].body.title === 'Short' && created[0].body.markPending === true, 'sidebar transform creates its document through host.createDocument');
assert(sent?.success === true && sent.filename === 'short.md', 'sidebar transform answers with the created file');

assert(!fetched.some((u) => /127\.0\.0\.1|localhost|\/api\/plugins\/config|\/api\/documents/.test(u)), 'no call back into the server over HTTP');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
