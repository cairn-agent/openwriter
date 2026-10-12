/**
 * The moderation tools call the site's comment and ban endpoints and return plain JSON
 * (plugins/publish/src/site-moderation-tools.ts; openwriter-publish adr/site-moderation.md).
 *
 * The API is mocked: fetch is replaced, and the publish config lives in a throwaway data folder
 * (OW_DATA_DIR in the temp dir), never ~/.openwriter. Nothing reaches the network.
 *
 * Run from packages/openwriter after building the server and the publish plugin:
 *   `node scripts/test-site-moderation.mjs`
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-site-moderation-'));
process.env.OW_DATA_DIR = dataDir;
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  plugins: { '@openwriter/plugin-publish': { config: { 'api-key': 'ow_live_test', 'api-url': 'http://localhost:9' } } },
}));
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { siteModerationTools } = await import('../../../plugins/publish/dist/site-moderation-tools.js');
const { default: plugin } = await import('../../../plugins/publish/dist/index.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

let calls = [];
let reply = () => ({ status: 200, body: {} });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const call = { method: init.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: init.headers ?? {}, body: init.body };
  calls.push(call);
  const r = reply(call);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

const tools = Object.fromEntries(siteModerationTools({}).map((t) => [t.name, t]));
async function run(name, params, answer) {
  calls = [];
  reply = answer ?? (() => ({ status: 200, body: {} }));
  return tools[name].handler(params);
}

console.log('\nTest 1: comments');
{
  const out = await run('list_site_comments', { reported: true, post_id: 'p1', limit: 10 }, () => ({
    status: 200,
    body: { comments: [{
      id: 'c1', post_id: 'p1', post_title: 'Week 12', parent_id: null, body: 'Buy now', status: 'visible', pinned: false,
      report_count: 3, created_at: '2026-10-12T00:00:00Z', reader_name: 'Spam', reader_email: 'spam@x.com',
    }] },
  }));
  const c = calls[0];
  assert(c.method === 'GET' && c.path === '/sites/comments', 'list_site_comments: GET /sites/comments');
  assert(c.query.get('reported') === '1' && c.query.get('post_id') === 'p1' && c.query.get('limit') === '10', 'list: filters passed');
  assert(JSON.stringify(out.comments[0]) === JSON.stringify({
    id: 'c1', post_id: 'p1', post_title: 'Week 12', body: 'Buy now', status: 'visible', pinned: false, report_count: 3,
    created_at: '2026-10-12T00:00:00Z', reader: { name: 'Spam', email: 'spam@x.com' },
  }), 'list: each comment carries its reader as { name, email }');

  await run('delete_site_comment', { comment_id: 'c 1', site: 'friend' }, () => ({ status: 200, body: { deleted: true } }));
  assert(calls[0].method === 'DELETE' && calls[0].path === '/sites/comments/c%201', 'delete_site_comment: DELETE /sites/comments/:id');
  assert(calls[0].headers['X-Site'] === 'friend', 'site param sends X-Site');

  const pinned = await run('pin_site_comment', { comment_id: 'c1', pinned: false });
  assert(calls[0].method === 'POST' && calls[0].path === '/sites/comments/c1/unpin' && pinned.pinned === false, 'pin_site_comment false: POST unpin');

  const approved = await run('approve_site_comment', { comment_id: 'c1' }, () => ({ status: 200, body: { approved: true, report_count: 0 } }));
  assert(calls[0].method === 'POST' && calls[0].path === '/sites/comments/c1/approve', 'approve_site_comment: POST approve');
  assert(approved.approved === true && approved.report_count === 0, 'approve: reports cleared');

  const missing = await run('approve_site_comment', { comment_id: 'gone' }, () => ({ status: 404, body: { error: 'No visible comment with that id on this site.' } }));
  assert(/No visible comment/.test(missing.error ?? ''), 'approve: the server sentence comes back as error');
}

console.log('\nTest 2: bans');
{
  const result = {
    banned: ['a@x.com'], already_banned: [], invalid: ['nope'], unsubscribed: ['a@x.com'], requests_denied: 0, comments_deleted: 2,
    paid_access_kept: [{ email: 'a@x.com', tier: 'paid' }], note: 'A ban does not cancel paid access.',
  };
  const out = await run('ban_readers', { emails: ['a@x.com', 'nope'], reason: 'spam', delete_comments: true }, () => ({ status: 200, body: result }));
  assert(calls[0].method === 'POST' && calls[0].path === '/sites/bans', 'ban_readers: POST /sites/bans');
  const sent = JSON.parse(calls[0].body);
  assert(sent.emails.length === 2 && sent.reason === 'spam' && sent.delete_comments === true, 'ban: emails, reason and delete_comments sent');
  assert(out.success && out.paid_access_kept[0].tier === 'paid' && /does not cancel/.test(out.note), 'ban: the server result, paid access kept included');

  await run('ban_readers', { emails: 'one@x.com' });
  assert(JSON.parse(calls[0].body).emails[0] === 'one@x.com', 'ban: a single email string is sent as a list');
  const none = await run('ban_readers', { emails: [] });
  assert(none.error && calls.length === 0, 'ban: an empty list is refused before the API');

  const un = await run('unban_reader', { email: 'A@x.com' }, () => ({ status: 200, body: { unbanned: 'a@x.com' } }));
  assert(calls[0].method === 'DELETE' && calls[0].path === '/sites/bans/A%40x.com', 'unban_reader: DELETE /sites/bans/:email');
  assert(un.unbanned === 'a@x.com', 'unban: the email returned');

  const list = await run('list_banned_readers', { limit: 5 }, () => ({ status: 200, body: { total: 1, bans: [{ email: 'a@x.com', reason: 'spam' }] } }));
  assert(calls[0].method === 'GET' && calls[0].path === '/sites/bans' && calls[0].query.get('limit') === '5', 'list_banned_readers: GET /sites/bans');
  assert(list.total === 1 && list.bans[0].email === 'a@x.com', 'list: bans and total');
}

console.log('\nTest 3: registered once, no name clashes');
{
  const names = plugin.mcpTools({}, {}).map((t) => t.name);
  for (const n of Object.keys(tools)) assert(names.filter((x) => x === n).length === 1, `${n} registered exactly once`);
  assert(new Set(names).size === names.length, 'no two publish tools share a name');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
