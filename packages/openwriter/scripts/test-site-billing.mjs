/**
 * The billing tools call the site's pause, pledge and offer-email endpoints and return plain JSON
 * (plugins/publish/src/site-billing-tools.ts; openwriter-publish adr/site-stripe-connect.md).
 *
 * The API is mocked: fetch is replaced, and the publish config lives in a throwaway data folder
 * (OW_DATA_DIR in the temp dir), never ~/.openwriter. Nothing reaches the network.
 *
 * Run from packages/openwriter after building the server and the publish plugin:
 *   `node scripts/test-site-billing.mjs`
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-site-billing-'));
process.env.OW_DATA_DIR = dataDir;
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  plugins: { '@openwriter/plugin-publish': { config: { 'api-key': 'ow_live_test', 'api-url': 'http://localhost:9' } } },
}));
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { siteBillingTools } = await import('../../../plugins/publish/dist/site-billing-tools.js');
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

const tools = Object.fromEntries(siteBillingTools({}).map((t) => [t.name, t]));
async function run(name, params, answer) {
  calls = [];
  reply = answer ?? (() => ({ status: 200, body: {} }));
  return tools[name].handler(params);
}
const sent = (i = 0) => JSON.parse(calls[i].body);

console.log('\nTest 1: pause and resume billing');
{
  const out = await run('pause_billing', { resume_at: '2026-11-03', site: 'friend' }, () => ({
    status: 200, body: { billing_paused: { since: 'x', resume_at: '2026-11-03T00:00:00.000Z' }, paused: 3, failed: [], message: 'Billing is paused until Nov 3, 2026.' },
  }));
  assert(calls[0].method === 'POST' && calls[0].path === '/sites/billing/pause', 'pause_billing: POST /sites/billing/pause');
  assert(sent().resume_at === '2026-11-03' && calls[0].headers['X-Site'] === 'friend', 'pause: resume_at and X-Site sent');
  assert(out.success && out.paused === 3 && /paused until/.test(out.message), 'pause: the server result');

  const no = await run('resume_billing', {}, () => ({ status: 409, body: { error: 'not_paused', message: 'Billing is not paused.' } }));
  assert(calls[0].path === '/sites/billing/resume' && no.error === 'Billing not resumed: Billing is not paused.', 'resume_billing: the refusal as a sentence');

  await run('pause_subscriber_billing', { member_id: 'm 1', resume_at: '2026-12-01' });
  assert(calls[0].path === '/sites/members/m%201/pause' && sent().paused === true && sent().resume_at === '2026-12-01', 'pause_subscriber_billing: paused by default');
  await run('pause_subscriber_billing', { member_id: 'm1', paused: false });
  assert(sent().paused === false && sent().resume_at === undefined, 'pause_subscriber_billing: paused false resumes');
  await run('pause_subscriber_billing', { email: 'Ann@X.com' }, (c) => c.path === '/sites/members'
    ? { status: 200, body: { members: [{ id: 'm9', email: 'ann@x.com' }] } }
    : { status: 200, body: {} });
  assert(calls[1].path === '/sites/members/m9/pause', 'pause_subscriber_billing: found by email');
}

console.log('\nTest 2: pledges');
{
  await run('set_pledges', { enabled: true, monthly: 700, founding: null });
  assert(calls[0].method === 'PUT' && calls[0].path === '/sites/pledges/settings', 'set_pledges: PUT /sites/pledges/settings');
  assert(JSON.stringify(sent()) === JSON.stringify({ enabled: true, monthly: 700, founding: null }), 'set_pledges: only the fields given');

  const list = await run('list_pledges', { limit: 5 }, () => ({ status: 200, body: { count: 2, monthly_revenue: 1117, pledges: [] } }));
  assert(calls[0].method === 'GET' && calls[0].path === '/sites/pledges' && calls[0].query.get('limit') === '5', 'list_pledges: GET /sites/pledges');
  assert(list.count === 2 && list.monthly_revenue === 1117, 'list_pledges: the server answer as is');

  const dry = await run('email_pledgers', { body: 'Thank **you**', dry_run: true }, () => ({ status: 200, body: { dry_run: true, recipients: 2, can_send: true } }));
  assert(calls[0].path === '/sites/pledges/email' && /<strong>you<\/strong>/.test(sent().body_html) && sent().dry_run === true, 'email_pledgers: markdown body, dry_run');
  assert(dry.dry_run === true && dry.recipients === 2 && dry.success === undefined, 'email_pledgers: a dry run is returned as is');
}

console.log('\nTest 3: email an offer');
{
  const out = await run('email_offer', { offer_id: 'o1', subject: 'A month on us', body: 'Come read', search: 'gmail' }, () => ({
    status: 202, body: { sent: true, id: 'i1', recipients: 40, subject: 'A month on us', message: 'Sending to 40 people.' },
  }));
  assert(calls[0].method === 'POST' && calls[0].path === '/sites/offers/o1/email', 'email_offer: POST /sites/offers/:id/email');
  assert(sent().subject === 'A month on us' && /Come read/.test(sent().body_html) && sent().search === 'gmail' && sent().tier === undefined, 'email_offer: tier left to the server default');
  assert(out.success && out.recipients === 40, 'email_offer: sent');
  const empty = await run('email_offer', { offer_id: 'o1', subject: 'x', body: ' ' });
  assert(empty.error && calls.length === 0, 'email_offer: an empty message is refused before the API');
  const ended = await run('email_offer', { offer_id: 'o1', subject: 'x', body: 'y' }, () => ({ status: 409, body: { error: 'This offer has ended, so its link no longer works.' } }));
  assert(/has ended/.test(ended.error), 'email_offer: the refusal sentence');
}

console.log('\nTest 4: registered once, no name clashes');
{
  const names = plugin.mcpTools({}, {}).map((t) => t.name);
  for (const n of Object.keys(tools)) assert(names.filter((x) => x === n).length === 1, `${n} registered exactly once`);
  assert(new Set(names).size === names.length, 'no two publish tools share a name');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
