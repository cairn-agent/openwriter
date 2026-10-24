/**
 * Publishing tools that work on the open document also take a docId (plugins/publish/src/helpers.ts
 * withDocId): named, that document opens first and is the one published, never whatever happened
 * to be open. Left out, the open document, as before.
 *
 * The API is mocked: fetch is replaced, and documents and config live in a throwaway data folder
 * (OW_DATA_DIR in the temp dir), never ~/.openwriter. Nothing reaches the network.
 *
 * Run from packages/openwriter after building the server and the publish plugin:
 *   `node scripts/test-site-doc-target.mjs`
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-site-doc-target-'));
process.env.OW_DATA_DIR = dataDir;
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  plugins: { '@openwriter/plugin-publish': { config: { 'api-key': 'ow_live_test', 'api-url': 'http://localhost:9' } } },
}));
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { ensureDataDir } = await import('../dist/server/helpers.js');
ensureDataDir();
const { createDocumentFromRequest } = await import('../dist/server/document-create.js');
const { getDocId, getTitle } = await import('../dist/server/state.js');
const { default: plugin } = await import('../../../plugins/publish/dist/index.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

let sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (['POST', 'PATCH'].includes(init.method) && url.pathname.includes('/sites/posts')) sent.push(JSON.parse(init.body));
  const body = url.pathname.endsWith('/sites') ? { site: { slug: 'shore' } } : { post: { id: `p${sent.length}`, slug: 'a-post', status: 'published' } };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const tools = Object.fromEntries(plugin.mcpTools({ 'api-key': 'ow_live_test', 'api-url': 'http://localhost:9' }, { saveConfig: () => ({ success: true }) }).map((t) => [t.name, t]));

createDocumentFromRequest({ title: 'Harbour notes', content: 'Boats came in at dawn.' });
const harbour = getDocId();
createDocumentFromRequest({ title: 'Kitchen notes', content: 'The bread rose twice.' });
const kitchen = getDocId();

console.log('\nTest 1: the tools on the open document take a docId');
const onDoc = ['publish_to_site', 'unpublish_site_post', 'get_site_stats', 'preview_site_post', 'send_test_email',
  'get_post_share_link', 'revoke_post_share_link', 'get_poll_results', 'schedule_post'];
assert(onDoc.every((n) => tools[n]?.inputSchema.properties.docId?.type === 'string'), 'each of the nine has a docId input');
assert(!tools.list_site_posts.inputSchema.properties.docId && !tools.add_subscriber.inputSchema.properties.docId, 'tools not on a document have none');

console.log('\nTest 2: a named document is the one published');
assert(getDocId() === kitchen, 'Kitchen notes is open');
let r = await tools.publish_to_site.handler({ docId: harbour, audience: 'everyone' });
assert(r.success && sent.length === 1 && sent[0].title === 'Harbour notes' && /Boats came in/.test(sent[0].body_html), 'Harbour notes is sent, not the open Kitchen notes');
assert(getDocId() === harbour && getTitle() === 'Harbour notes', 'and it is open in the editor now');

console.log('\nTest 3: no docId, the open document; an unknown one, nothing sent');
r = await tools.publish_to_site.handler({ audience: 'everyone' });
assert(r.success && r.action === 'updated' && sent.length === 2 && /Boats came in/.test(sent[1].body_html), 'without docId the open document is published (its post updated)');
r = await tools.publish_to_site.handler({ docId: 'ffffffff', audience: 'everyone' });
assert(r.error && sent.length === 2 && getDocId() === harbour, 'an unknown docId is refused and nothing changes');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
