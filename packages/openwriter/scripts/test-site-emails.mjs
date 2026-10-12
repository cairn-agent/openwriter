/**
 * The email settings and sender tools (plugins/publish/src/site-tools.ts update_site_settings and get_site,
 * site-team-tools.ts update_team_member, site-sender-tools.ts): the header, footer and banner for all
 * readers or per audience, reply-to and subscriber notices; the sending domain under its plain name with
 * the old names kept as deprecated aliases.
 *
 * The API is mocked: fetch is replaced, and the publish config lives in a throwaway data folder
 * (OW_DATA_DIR in the temp dir), never ~/.openwriter. Nothing reaches the network.
 *
 * Run from packages/openwriter after building the server and the publish plugin:
 *   `node scripts/test-site-emails.mjs`
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-site-emails-'));
process.env.OW_DATA_DIR = dataDir;
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  plugins: { '@openwriter/plugin-publish': { config: { 'api-key': 'ow_live_test', 'api-url': 'http://localhost:9' } } },
}));
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

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
  const call = { method: init.method ?? 'GET', path: url.pathname, headers: init.headers ?? {}, body: init.body };
  calls.push(call);
  const r = reply(call);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

const all = plugin.mcpTools({}, {});
const tools = Object.fromEntries(all.map((t) => [t.name, t]));
async function run(name, params, answer) {
  calls = [];
  reply = answer ?? (() => ({ status: 200, body: {} }));
  return tools[name].handler(params);
}

console.log('\nTest 1: update_site_settings');
{
  const settings = { email_header: { free: 'Old free', paid: 'Old paid' } };
  await run('update_site_settings', { email_header: 'Hi all', reply_to: 'me@x.com', notify_free_subscribers: 'off' });
  const sent = JSON.parse(calls[0].body);
  assert(calls.length === 1 && calls[0].method === 'PATCH' && calls[0].path === '/sites/settings', 'one PATCH /sites/settings');
  assert(sent.email_header === 'Hi all' && sent.reply_to === 'me@x.com' && sent.notify_free_subscribers === 'off', 'everyone header, reply-to and a notice mode passed as given');

  await run('update_site_settings', { email_footer_free: 'Upgrade', email_footer_paid: 'Thanks' });
  assert(calls.length === 1, 'both audiences given: no read first');
  assert(JSON.stringify(JSON.parse(calls[0].body).email_footer) === '{"free":"Upgrade","paid":"Thanks"}', 'footer sent as { free, paid }');

  await run('update_site_settings', { email_header_paid: 'New paid', site: 'anna' }, (c) => (
    c.method === 'GET' ? { status: 200, body: { settings } } : { status: 200, body: { settings: {} } }
  ));
  assert(calls[0].method === 'GET' && calls[0].path === '/sites/settings' && calls[0].headers['X-Site'] === 'anna', 'one audience: reads the current settings of that site');
  assert(JSON.stringify(JSON.parse(calls[1].body).email_header) === '{"free":"Old free","paid":"New paid"}', 'the other audience keeps what it has');

  const both = await run('update_site_settings', { email_banner: 'https://x.test/a.png', email_banner_free: '' });
  assert(both.error && calls.length === 0, 'all readers and one audience at once is refused before the API');

  const bad = await run('update_site_settings', { reply_to: 'nope' }, () => ({ status: 400, body: { error: 'reply_to must be an email address, or null for your account email.' } }));
  assert(bad.error === 'Could not update settings: reply_to must be an email address, or null for your account email.', 'server refusal as a plain sentence');
}

console.log('\nTest 2: get_site shows the sender settings');
{
  const sender = { from_name: 'Anna', from_email: 'anna@mail.openwriter.io', reply_to: 'me@x.com', reply_to_is_default: false, sending_domain: null, mailing_address: '1 Main St' };
  const out = await run('get_site', {}, () => ({ status: 200, body: { site: { slug: 'anna', status: 'active' }, role: 'owner', payments: {}, sender } }));
  assert(JSON.stringify(out.sender) === JSON.stringify(sender), 'sender passed through');
}

console.log('\nTest 3: update_team_member notify');
{
  await run('update_team_member', { member_id: 't1', notify: true });
  assert(calls[0].method === 'PATCH' && calls[0].path === '/sites/team/t1' && JSON.parse(calls[0].body).notify === true, 'notify sent');
  const refused = await run('update_team_member', { member_id: 't2', notify: true }, () => ({
    status: 403, body: { error: 'not_yours', message: 'Only that admin can turn their own subscriber emails on or off.' },
  }));
  assert(/Only that admin/.test(refused.error), 'someone else\'s notify: the server message');
}

console.log('\nTest 4: the sending domain has its own name; the old names still work');
{
  const names = all.map((t) => t.name);
  assert(new Set(names).size === names.length, 'no two publish tools share a name');
  for (const [now, old] of [['set_sending_domain', 'setup_custom_domain'], ['check_sending_domain', 'check_domain_status'], ['resend_sending_domain_verification', 'resend_domain_verification']]) {
    assert(tools[now] && /sending/i.test(tools[now].description), `${now} is registered and says it is for sending`);
    assert(tools[old] && tools[old].description.startsWith(`DEPRECATED — renamed to ${now}`), `${old} is a deprecated alias of ${now}`);
    assert(tools[old].handler === tools[now].handler, `${old} does what ${now} does`);
  }
  assert(/website address/i.test(tools.set_site_domain.description) && /set_sending_domain/.test(tools.set_site_domain.description), 'set_site_domain says it is the website address');

  const out = await run('set_sending_domain', { domain: 'x.com', from_email: 'hi@x.com' }, () => ({
    status: 200, body: { domain: { id: 'd1', domain: 'x.com' }, dnsRecords: [], cloudflare_managed: false, dns_auto_added: false, sender_verification_sent: true, next_action: 'Add the records.' },
  }));
  assert(calls[0].method === 'POST' && calls[0].path === '/newsletter/domains' && out.domainId === 'd1', 'set_sending_domain: POST /newsletter/domains');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
