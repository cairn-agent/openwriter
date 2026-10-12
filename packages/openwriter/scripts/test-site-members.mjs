/**
 * The subscriber tools act on the site's member list, the one list site posts are emailed to
 * (plugins/publish/src/site-member-tools.ts; openwriter-publish adr/one-subscriber-list.md).
 * Each tool must call the /sites/members endpoint, never the old /newsletter/subscribers list.
 *
 * The API is mocked: fetch is replaced, and the publish config lives in a throwaway data folder
 * (OW_DATA_DIR in the temp dir), never ~/.openwriter. Nothing reaches the network.
 *
 * Run from packages/openwriter after building the server and the publish plugin:
 *   `node scripts/test-site-members.mjs`
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-site-members-'));
process.env.OW_DATA_DIR = dataDir;
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  plugins: { '@openwriter/plugin-publish': { config: { 'api-key': 'ow_live_test', 'api-url': 'http://localhost:9' } } },
}));
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { siteMemberTools, readSubscriberCsv } = await import('../../../plugins/publish/dist/site-member-tools.js');
const { newsletterTools } = await import('../../../plugins/publish/dist/newsletter-tools.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

/** Every request the tools made, answered from `reply` by method + path. */
let calls = [];
let reply = () => ({ status: 200, body: {} });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const call = { method: init.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: init.headers ?? {}, body: init.body };
  calls.push(call);
  const r = reply(call);
  const isText = typeof r.body === 'string';
  return new Response(isText ? r.body : JSON.stringify(r.body), {
    status: r.status, headers: { 'Content-Type': isText ? 'text/csv' : 'application/json' },
  });
};

const tools = Object.fromEntries(siteMemberTools({}).map((t) => [t.name, t]));
async function run(name, params, answer) {
  calls = [];
  reply = answer ?? (() => ({ status: 200, body: {} }));
  return tools[name].handler(params);
}

console.log('\nTest 1: each tool calls the site member endpoint');
{
  const out = await run('list_subscribers', { tier: 'paid', limit: 5 }, () => ({
    status: 200, body: { total: 7, members: [{ id: 'm1', email: 'a@x.com', name: 'A', tier: 'paid', status: 'active', source: 'import', subscribed_at: '2026-10-01' }] },
  }));
  const c = calls[0];
  assert(c.method === 'GET' && c.path === '/sites/members', 'list_subscribers: GET /sites/members');
  assert(c.query.get('status') === 'active' && c.query.get('tier') === 'paid' && c.query.get('limit') === '5', 'list: active by default, filters passed');
  assert(out.count === 7 && out.subscribers[0].id === 'm1' && out.subscribers[0].tier === 'paid', 'list: total and members returned');

  await run('list_subscribers', { status: 'all' }, () => ({ status: 200, body: { total: 0, members: [] } }));
  assert(!calls[0].query.has('status'), 'list: status "all" sends no status filter');

  const counts = await run('get_subscriber_counts', {}, () => ({ status: 200, body: { counts: { free_list_size: 3 } } }));
  assert(calls[0].method === 'GET' && calls[0].path === '/sites/members/counts', 'get_subscriber_counts: GET /sites/members/counts');
  assert(counts.free_list_size === 3, 'counts returned');

  const added = await run('add_subscriber', { email: 'b@x.com', name: 'Bo' }, () => ({
    status: 201, body: { created: true, member: { id: 'm2', email: 'b@x.com' } },
  }));
  assert(calls[0].method === 'POST' && calls[0].path === '/sites/members', 'add_subscriber: POST /sites/members');
  assert(JSON.parse(calls[0].body).email === 'b@x.com' && JSON.parse(calls[0].body).name === 'Bo', 'add: email and name sent');
  assert(added.success && added.subscriber.id === 'm2', 'add: member returned');
  assert(!('send_welcome' in JSON.parse(calls[0].body)) && added.welcome_sent === undefined, 'add: no welcome unless asked');

  const welcomed = await run('add_subscriber', { email: 'c@x.com', send_welcome: true }, () => ({
    status: 200, body: { created: false, member: { id: 'm3', email: 'c@x.com' }, welcome_sent: false, welcome_note: 'c@x.com was welcomed before; the welcome email is sent once.' },
  }));
  assert(JSON.parse(calls[0].body).send_welcome === true, 'add: send_welcome sent');
  assert(welcomed.welcome_sent === false && /welcomed before/.test(welcomed.message), 'add: why no welcome went out is in the message');

  const refused = await run('add_subscriber', { email: 'gone@x.com' }, () => ({
    status: 409, body: { error: 'unsubscribed', message: 'gone@x.com has unsubscribed; they must subscribe again themselves.' },
  }));
  assert(/must subscribe again themselves/.test(refused.error ?? ''), 'add: an unsubscribed person is refused with the server message');

  await run('remove_subscriber', { id: 'm 2' }, () => ({ status: 200, body: { unsubscribed: true } }));
  assert(calls[0].method === 'DELETE' && calls[0].path === '/sites/members/m%202', 'remove_subscriber: DELETE /sites/members/:id');

  const embed = await run('get_subscribe_embed', {}, () => ({
    status: 200, body: { subscribe_url: 'https://publish.openwriter.io/subscribe/k', site_url: null, double_opt_in: false },
  }));
  assert(calls[0].method === 'GET' && calls[0].path === '/sites/members/embed', 'get_subscribe_embed: GET /sites/members/embed');
  assert(/claim_site_name/.test(embed.instructions), 'embed: says to claim a site name when there is none');
}

console.log('\nTest 2: import sends the cleaned list to the site import; export saves the CSV');
{
  const csv = 'Email Address,First Name,Last Name,Status\nann@x.com,Ann,Lee,active\nleft@x.com,,,unsubscribed\n"bo, jr@x.com",Bo,,active\n';
  const out = await run('import_subscribers', { csv_text: csv }, () => ({
    status: 200, body: { imported: 1, skipped: { already_members: 1, duplicate_in_file: 0, invalid: 0 }, invalid_examples: [] },
  }));
  const c = calls[0];
  assert(c.method === 'POST' && c.path === '/sites/members/import', 'import_subscribers: POST /sites/members/import');
  const sent = JSON.parse(c.body).csv.split('\n');
  assert(sent[0] === 'email,name' && sent[1] === 'ann@x.com,Ann Lee', 'import: first + last name joined');
  assert(sent.length === 3 && sent[2] === '"bo, jr@x.com",Bo', 'import: unsubscribed row dropped, commas quoted');
  assert(out.imported === 1 && out.skippedStatus === 1 && out.alreadyMembers === 1, 'import: counts from the server and the file');

  const file = join(dataDir, 'out.csv');
  const exp = await run('export_subscribers', { file, tier: 'free' }, () => ({ status: 200, body: 'email,name\r\na@x.com,A\r\n' }));
  assert(calls[0].method === 'GET' && calls[0].path === '/sites/members/export', 'export_subscribers: GET /sites/members/export');
  assert(calls[0].query.get('tier') === 'free' && calls[0].query.get('status') === 'active', 'export: filters passed');
  assert(exp.rows === 1 && readFileSync(file, 'utf-8').startsWith('email,name'), 'export: saved to the file');

  assert('error' in readSubscriberCsv('name\nAnn'), 'csv without an email column is refused');
}

console.log('\nTest 3: the site parameter and the old list');
{
  await run('list_subscribers', { site: 'friend' }, () => ({ status: 200, body: { total: 0, members: [] } }));
  assert(calls[0].headers['X-Site'] === 'friend', 'site param sends X-Site');
  const names = newsletterTools({}).map((t) => t.name);
  assert(!names.some((n) => /subscriber|subscribe_embed/.test(n)), 'newsletter tools no longer carry subscriber tools (no duplicate names)');
  assert(!names.includes('send_newsletter') && !names.includes('resend_to_unopened'), 'the old newsletter send is gone: site posts are the one way to email readers');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
