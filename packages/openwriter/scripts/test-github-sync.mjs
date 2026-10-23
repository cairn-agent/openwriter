/**
 * Two-way GitHub sync (github plugin): two data folders and a local bare repo
 * standing in for GitHub. No network and no real GitHub.
 *
 * Runs against a throwaway home folder (HOME/USERPROFILE in the temp dir), so
 * ~/.openwriter is never touched. Two profiles, A and B, are the two copies
 * (say the desktop app and the online copy). adr: adr/two-way-sync.md
 *
 * Run: `node scripts/test-github-sync.mjs` (after `npm run build`)
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const home = mkdtempSync(join(tmpdir(), 'ow-sync-test-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.OW_DATA_DIR;
// Keep the machine's own git config (credential managers, identities) out.
writeFileSync(join(home, 'gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = join(home, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { ROOT_DIR, setActiveProfile, ensureDataDir, getDataDir } = await import('../dist/server/helpers.js');
if (!ROOT_DIR.startsWith(home)) { console.error(`Refusing to run: data root ${ROOT_DIR} is not in the temp folder`); process.exit(1); }
const { load, clearAllCaches, cancelDebouncedSave, save, getPlainText } = await import('../dist/server/state.js');
const { switchDocument } = await import('../dist/server/documents.js');
const sync = await import('../../../plugins/github/dist/git-sync.js');
const device = await import('../../../plugins/github/dist/device-flow.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
const remote = join(home, 'github.git');
execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);

/** Make `name` the live copy: what a separate server for that folder would hold. */
function side(name) {
  cancelDebouncedSave();
  save();
  setActiveProfile(name);
  ensureDataDir();
  clearAllCaches();
  load();
  return getDataDir();
}

function writeDoc(dir, file, title, docId, paragraphs) {
  writeFileSync(join(dir, file), `---\n${JSON.stringify({ title, docId })}\n---\n\n${paragraphs.join('\n\n')}\n`);
}
const read = (dir, file) => readFileSync(join(dir, file), 'utf-8');
const frontmatter = (raw) => JSON.parse(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
const noop = () => {};

const essay = ['Essay one.', 'Essay two.', 'Essay three.', 'Essay four.', 'Essay five.'];

console.log('\nA connects to an empty GitHub repo and pushes:');
let A = side('A');
writeDoc(A, 'Scratch A.md', 'Scratch A', 'aaaa0001', ['A scratch.']);
writeDoc(A, 'Essay.md', 'Essay', 'e55a0001', essay);
writeDoc(A, 'Notes.md', 'Notes', '0e7e0001', ['Notes start.']);
writeDoc(A, 'Old.md', 'Old', '01d00001', ['Old text.']);
switchDocument('Scratch A.md');
const pat = 'ghp_TESTONLY_not_a_real_token_1234';
await sync.saveDeviceName("Maya's laptop");
assert((await sync.connectExisting(remote, pat)).length === 0, 'connect reports no conflicts');
assert(git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('Essay.md'), 'GitHub has Essay.md');
assert(git(remote, 'log', '-1', '--format=%an', 'main') === "Maya's laptop", 'commits are signed with the device name');
assert(git(remote, 'ls-tree', '--name-only', 'main').split('\n').includes('.openwriter'), 'the repo carries the OpenWriter marker');
assert(!git(remote, 'ls-tree', '--name-only', 'main').includes('openwriter-device'), 'the device file is not synced');

console.log('\nCredentials stay out of git:');
assert(!read(A, '.git/config').includes(pat), '.git/config does not contain the token');
assert(git(A, 'remote', 'get-url', 'origin') === remote, 'remote URL is the plain URL');
assert(JSON.parse(readFileSync(join(ROOT_DIR, 'github-token.json'), 'utf-8')).token === pat, 'token stored in the token file');
assert(!readFileSync(join(ROOT_DIR, 'config.json'), 'utf-8').includes(pat), 'config.json does not contain the token');
assert(!git(A, 'ls-files').includes('github-token'), 'token file is outside the synced folder');
assert(sync.sanitizeRemoteUrl('https://u:secret@github.com/o/r.git') === 'https://github.com/o/r.git', 'credentials are stripped from a pasted URL');

console.log('\nB (empty folder) connects and pulls everything down:');
let B = side('B');
assert(!existsSync(join(B, 'Essay.md')), 'B starts without Essay.md');
await sync.saveDeviceName('Web');
assert((await sync.connectExisting(remote)).length === 0, 'first connection has no conflicts');
assert(read(B, 'Essay.md').includes('Essay five.'), 'B has Essay.md with its text');
assert(existsSync(join(B, 'Notes.md')) && existsSync(join(B, 'Old.md')), 'B has every document');
writeDoc(B, 'Scratch B.md', 'Scratch B', 'bbbb0001', ['B scratch.']);
switchDocument('Scratch B.md');
assert((await sync.syncNow(noop)).state === 'synced', 'B syncs cleanly');

console.log('\nEdits on both sides to different paragraphs merge:');
A = side('A');
switchDocument('Scratch A.md');
writeDoc(A, 'Essay.md', 'Essay', 'e55a0001', ['Essay one, edited on A.', ...essay.slice(1)]);
assert((await sync.syncNow(noop)).state === 'synced', 'A syncs');
B = side('B');
switchDocument('Scratch B.md');
writeDoc(B, 'Essay.md', 'Essay', 'e55a0001', [...essay.slice(0, 4), 'Essay five, edited on B.']);
let r = await sync.syncNow(noop);
assert(r.state === 'synced' && !r.conflicts, 'B syncs without conflicts');
assert(read(B, 'Essay.md').includes('edited on A') && read(B, 'Essay.md').includes('edited on B'), 'B has both edits');
A = side('A');
await sync.syncNow(noop);
assert(read(A, 'Essay.md').includes('edited on A') && read(A, 'Essay.md').includes('edited on B'), 'A has both edits after its next sync');

console.log('\nThe running server shows a pulled change to the open doc:');
B = side('B');
switchDocument('Essay.md');
A = side('A');
switchDocument('Scratch A.md');
writeDoc(A, 'Essay.md', 'Essay', 'e55a0001', ['Essay one, edited on A.', 'Essay two, live update.', ...essay.slice(2, 4), 'Essay five, edited on B.']);
await sync.syncNow(noop);
B = side('B');
switchDocument('Essay.md');
// No side() call between the pull and the check: this is the same running server.
await sync.syncNow(noop);
assert(getPlainText().includes('live update'), 'open doc shows the pulled text without a restart');

console.log('\nA real conflict keeps both versions:');
A = side('A');
switchDocument('Scratch A.md');
writeDoc(A, 'Notes.md', 'Notes', '0e7e0001', ['Notes written on A.']);
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
writeDoc(B, 'Notes.md', 'Notes', '0e7e0001', ['Notes written on B.']);
r = await sync.syncNow(noop);
assert(r.state === 'synced', 'B syncs despite the conflict');
assert(r.conflicts?.length === 1 && /^Notes \(from GitHub .+\)\.md$/.test(r.conflicts[0]), `conflict copy named after the doc (${r.conflicts?.[0]})`);
assert(read(B, 'Notes.md').includes('written on B'), "B's own version stays in place");
const copy = r.conflicts[0];
assert(read(B, copy).includes('written on A'), "GitHub's version is in the copy");
assert(!read(B, 'Notes.md').includes('<<<<<<<') && !read(B, copy).includes('<<<<<<<'), 'no conflict markers in either file');
const fm = frontmatter(read(B, copy));
assert(fm.docId && fm.docId !== '0e7e0001', 'copy has its own docId');
assert(fm.title.startsWith('Notes (from GitHub'), 'copy title says where it came from');
assert((await sync.getSyncStatus()).conflicts?.[0] === copy, 'status reports the conflict');
A = side('A');
await sync.syncNow(noop);
const aText = readdirSync(A).filter((f) => f.startsWith('Notes')).map((f) => read(A, f)).join('\n');
assert(aText.includes('written on A') && aText.includes('written on B'), 'A ends with both texts too');

console.log('\nAn edit beats a delete:');
B = side('B');
switchDocument('Scratch B.md');
writeDoc(B, 'Old.md', 'Old', '01d00001', ['Old text, edited on B.']);
await sync.syncNow(noop);
A = side('A');
switchDocument('Scratch A.md');
unlinkSync(join(A, 'Old.md'));
// A deleted Old.md without pulling first; B's edit is already on GitHub.
r = await sync.syncNow(noop);
assert(r.state === 'synced', 'A syncs');
assert(existsSync(join(A, 'Old.md')) && read(A, 'Old.md').includes('edited on B'), "B's edit survives A's delete");

console.log('\nThe open doc is not deleted by a pull:');
B = side('B');
switchDocument('Essay.md');
A = side('A');
switchDocument('Scratch A.md');
unlinkSync(join(A, 'Essay.md'));
await sync.syncNow(noop);
B = side('B');
switchDocument('Essay.md');
r = await sync.syncNow(noop);
assert(r.state === 'synced', 'B syncs');
assert(existsSync(join(B, 'Essay.md')) && read(B, 'Essay.md').includes('live update'), 'B keeps the open doc');
assert(git(B, 'ls-files', 'Essay.md') === 'Essay.md', 'and commits it again');

console.log('\nConnecting a folder that already has writing merges, never overwrites:');
const C = side('C');
writeDoc(C, 'Notes.md', 'Notes', 'c0c00001', ['Notes from a third copy.']);
writeDoc(C, 'Own.md', 'Own', 'c0c00002', ['Only here.']);
const copies = await sync.connectExisting(remote);
assert(read(C, 'Notes.md').includes('third copy'), "C's Notes.md is kept");
assert(copies.length === 1 && read(C, copies[0]).includes('Notes written on B'), "GitHub's Notes.md is saved as a copy");
assert(existsSync(join(C, 'Own.md')) && existsSync(join(C, 'Essay.md')), "C keeps its own doc and gets GitHub's");

console.log('\nA second device finds the documents already on GitHub (GitHub replies faked):');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u.endsWith('/user')) return reply({ login: 'maya', name: 'Maya Lin' });
  if (u.includes('/user/repos')) return reply([
    { full_name: 'maya/website', name: 'website', size: 10, private: false },
    { full_name: 'maya/my-writing', name: 'my-writing', size: 10, private: true },
    { full_name: 'maya/openwriter-docs', name: 'openwriter-docs', size: 0, private: true },
  ]);
  if (u.includes('/repos/maya/website/contents')) return reply([{ name: 'index.html', type: 'file' }, { name: 'README.md', type: 'file' }]);
  if (u.includes('/repos/maya/my-writing/contents')) return reply([{ name: '.openwriter', type: 'file' }, { name: 'Essay.md', type: 'file' }, { name: 'Notes.md', type: 'file' }, { name: '_pending', type: 'dir' }]);
  if (u.includes('/repos/maya/openwriter-docs/contents')) return reply({ message: 'This repository is empty.' }, 404);
  throw new Error(`unexpected fetch ${u}`);
};
try {
  const found = await sync.findDocsRepos();
  assert(found.repos[0]?.fullName === 'maya/my-writing' && found.repos[0].documents === 2, `the repo with documents is offered first, with its count (${JSON.stringify(found.repos[0])})`);
  assert(!found.repos.some((r) => r.name === 'website'), 'an unrelated repo is not offered');
  assert(found.repos.some((r) => r.name === 'openwriter-docs'), 'an empty openwriter-docs is offered too');
  assert(sync.suggestDeviceName(found.name) === "Maya's computer", 'device name suggestion uses the first name');
} finally {
  globalThis.fetch = realFetch;
}

console.log('\nSign in with GitHub (device flow, GitHub replies faked):');
delete process.env.OW_GITHUB_CLIENT_ID;
assert(device.deviceFlowClientId() === 'Ov23liCYclIOzGfwgfAH', 'every copy has the public OpenWriter client id by default');
process.env.OW_GITHUB_CLIENT_ID = 'Iv1.testclient';
const calls = [];
let polls = 0;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: String(init?.body) });
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (String(url).endsWith('/login/device/code')) return reply({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });
  if (String(url).endsWith('/login/oauth/access_token')) return reply(++polls === 1 ? { error: 'authorization_pending' } : { access_token: 'gho_TESTONLY_device_token' });
  throw new Error(`unexpected fetch ${url}`);
};
try {
  const start = await device.startDeviceFlow();
  assert(start.userCode === 'ABCD-1234' && start.verificationUri === 'https://github.com/login/device', 'start returns the code to show');
  assert(calls[0].body.includes('client_id=Iv1.testclient') && !calls[0].body.includes('secret'), 'only the public client id is sent');
  assert((await device.pollDeviceFlow()).status === 'pending', 'pending while the writer has not approved');
  assert((await device.pollDeviceFlow()).status === 'done', 'done once GitHub hands over the token');
  assert((await sync.readToken()) === 'gho_TESTONLY_device_token', 'device token stored');
  assert(!readFileSync(join(ROOT_DIR, 'config.json'), 'utf-8').includes('gho_TESTONLY'), 'device token is not in config.json');
} finally {
  globalThis.fetch = realFetch;
}

cancelDebouncedSave();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
