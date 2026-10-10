/**
 * Hosted mode: the gateway signature check and the hosted tool list.
 *
 * Runs against a throwaway data folder (OW_DATA_DIR in the temp dir), never
 * ~/.openwriter. Env is set before the server modules are imported, because
 * hosted mode is read once at load. adr: adr/hosted-gateway-trust.md
 *
 * Run: `node scripts/test-hosted-mode.mjs` (after `npm run build`)
 */

import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHmac } from 'crypto';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-hosted-test-'));
process.env.OW_HOSTED = '1';
process.env.OW_DATA_DIR = dataDir;
process.env.OW_GATEWAY_SECRET = 'test-secret';
process.env.OW_PUBLIC_URL = 'https://app.openwriter.io';
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { ROOT_DIR } = await import('../dist/server/helpers.js');
const { verifyGatewaySignature, authorizeGatewayRequest, hostedConfigProblems } = await import('../dist/server/hosted.js');
const { TOOL_REGISTRY } = await import('../dist/server/mcp.js');
const { discoverPlugins } = await import('../dist/server/plugin-discovery.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const now = Math.floor(Date.now() / 1000);
function signed(user, ts = now, secret = 'test-secret') {
  const sig = createHmac('sha256', secret).update(`${user}.${ts}`).digest('hex');
  return { 'x-ow-user': user, 'x-ow-timestamp': String(ts), 'x-ow-gateway': sig };
}

console.log('\nData root:');
assert(ROOT_DIR === dataDir, 'ROOT_DIR is OW_DATA_DIR in hosted mode');
assert(hostedConfigProblems({ OW_DATA_DIR: 'x', OW_GATEWAY_SECRET: 'y' }).length === 1, 'missing OW_PUBLIC_URL is refused');

console.log('\nSignature:');
assert(verifyGatewaySignature(signed('u1'), 'test-secret', now) === 'u1', 'valid signature names the writer');
assert(verifyGatewaySignature(signed('u1', now, 'wrong'), 'test-secret', now) === null, 'wrong key is refused');
assert(verifyGatewaySignature({ ...signed('u1'), 'x-ow-user': 'u2' }, 'test-secret', now) === null, 'signature for another user is refused');
assert(verifyGatewaySignature(signed('u1', now - 61), 'test-secret', now) === null, 'timestamp 61 s old is refused');
assert(verifyGatewaySignature(signed('u1', now + 61), 'test-secret', now) === null, 'timestamp 61 s ahead is refused');
assert(verifyGatewaySignature(signed('u1', now - 60), 'test-secret', now) === 'u1', 'timestamp 60 s old is accepted');
for (const h of ['x-ow-user', 'x-ow-timestamp', 'x-ow-gateway']) {
  const headers = signed('u1');
  delete headers[h];
  assert(verifyGatewaySignature(headers, 'test-secret', now) === null, `missing ${h} is refused`);
}
assert(verifyGatewaySignature(signed('u1'), '', now) === null, 'empty secret refuses everything');

console.log('\nOne writer per machine:');
assert(authorizeGatewayRequest({}) === 401, 'unsigned request: 401');
assert(authorizeGatewayRequest(signed('writer-a')) === 0, 'first verified writer is allowed');
assert(JSON.parse(readFileSync(join(dataDir, 'hosted-owner.json'), 'utf-8')).user === 'writer-a', 'owner recorded in the data folder');
assert(authorizeGatewayRequest(signed('writer-a')) === 0, 'same writer again is allowed');
assert(authorizeGatewayRequest(signed('writer-b')) === 403, 'second writer: 403');
assert(authorizeGatewayRequest(signed('writer-b', now, 'wrong')) === 401, 'bad signature stays 401, not 403');

console.log('\nHosted tool list:');
const names = new Set(TOOL_REGISTRY.map((t) => t.name));
for (const t of ['open_file', 'reload_from_disk', 'export_manuscript']) assert(!names.has(t), `${t} is absent`);
for (const t of ['read_pad', 'write_to_pad', 'create_document', 'compile_manuscript']) assert(names.has(t), `${t} is present`);
const plugins = new Set(discoverPlugins().map((p) => p.name));
assert(!plugins.has('@openwriter/plugin-github'), 'github plugin (blog + git sync) is not discovered');
assert(!plugins.has('@openwriter/plugin-x-api'), 'x-api plugin is not discovered');
assert(plugins.has('@openwriter/plugin-publish'), 'publish plugin is still discovered');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
