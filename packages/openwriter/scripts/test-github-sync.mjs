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

import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
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
const { load, clearAllCaches, cancelDebouncedSave, debouncedSave, save, getPlainText } = await import('../dist/server/state.js');
const { switchDocument, getActiveFilename } = await import('../dist/server/documents.js');
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

// Edit times are set on the commit (GIT_AUTHOR_DATE), the way commit-on-save stamps them.
const T = Math.floor(Date.now() / 1000) + 1000;
async function editAt(t, write) {
  write();
  process.env.GIT_AUTHOR_DATE = `${t} +0000`;
  try { return await sync.commitSaved(); } finally { delete process.env.GIT_AUTHOR_DATE; }
}
const notices = async () => (await sync.getSyncStatus()).notices || [];
const notes = (middle, end) => ['Notes intro.', middle, end];
const nodesA = { nodes: [['a1', ['x']]] };
const nodesB = { nodes: [['b1', ['y']]] };
function writeDocMeta(dir, file, title, docId, paragraphs, meta) {
  writeFileSync(join(dir, file), `---\n${JSON.stringify({ title, docId, ...meta })}\n---\n\n${paragraphs.join('\n\n')}\n`);
}

console.log('\nThe same paragraph changed on both: the newer edit wins, across an offline edit:');
A = side('A');
switchDocument('Scratch A.md');
writeDoc(A, 'Notes.md', 'Notes', '0e7e0001', notes('Notes middle.', 'Notes end.'));
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
await sync.syncNow(noop);
// B is offline and edits the middle later in the day than A does.
await editAt(T + 200, () => writeDocMeta(B, 'Notes.md', 'Notes', '0e7e0001', notes('Middle from B, offline.', 'Notes end.'), nodesB));
A = side('A');
switchDocument('Scratch A.md');
await editAt(T + 100, () => writeDocMeta(A, 'Notes.md', 'Notes', '0e7e0001', notes('Middle from A.', 'Notes end.'), nodesA));
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
r = await sync.syncNow(noop);
assert(r.state === 'synced' && !r.conflicts, 'B syncs, no conflict copy');
assert(read(B, 'Notes.md').includes('Middle from B, offline.') && !read(B, 'Notes.md').includes('Middle from A.'), "B's newer offline edit wins although A sent first");
assert(!readdirSync(B).some((f) => f.includes('from GitHub')), 'no "from GitHub" copies');
assert(!read(B, 'Notes.md').includes('<<<<'), 'no conflict markers');
assert(frontmatter(read(B, 'Notes.md')).docId === '0e7e0001', 'the document keeps its id');
assert((await notices()).length === 0, 'B, whose words won, gets no notice');
A = side('A');
switchDocument('Scratch A.md');
await sync.syncNow(noop);
assert(read(A, 'Notes.md').includes('Middle from B, offline.'), 'A gets the newer paragraph');
let n = (await notices()).find((x) => x.kind === 'replaced');
assert(n && n.device === 'Web' && n.earlier?.[0] === 'Middle from A.' && n.kept?.[0] === 'Middle from B, offline.' && n.title === 'Notes',
  `A, whose words were replaced, is told by whom (${JSON.stringify(n)})`);
assert((await sync.undoNotice(n.id, noop)).ok, 'Undo works');
assert(read(A, 'Notes.md').includes('Middle from A.') && !read(A, 'Notes.md').includes('Middle from B, offline.'), "Undo puts A's paragraph back");
assert((await notices()).length === 0, 'and the notice goes');
assert(git(A, 'log', '--all', '-p', '--', 'Notes.md').includes('Middle from B, offline.'), 'the other version stays in history');
await sync.syncNow(noop);

console.log('\n...and the older offline edit loses, with a notice on its device:');
B = side('B');
switchDocument('Scratch B.md');
await sync.syncNow(noop);
await editAt(T + 300, () => writeDocMeta(B, 'Notes.md', 'Notes', '0e7e0001', notes('Middle from A.', 'End from B.'), nodesB));
A = side('A');
switchDocument('Scratch A.md');
await editAt(T + 400, () => writeDocMeta(A, 'Notes.md', 'Notes', '0e7e0001', notes('Middle from A.', 'End from A.'), nodesA));
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
r = await sync.syncNow(noop);
assert(read(B, 'Notes.md').includes('End from A.') && !read(B, 'Notes.md').includes('End from B.'), "A's newer edit wins on B");
n = (await notices()).find((x) => x.kind === 'replaced');
assert(n && n.device === "Maya's laptop" && n.earlier?.[0] === 'End from B.', 'B is told its paragraph was replaced, and by whom');

console.log('\nAppend-only logs merge without a clash:');
A = side('A');
switchDocument('Scratch A.md');
await sync.syncNow(noop);
mkdirSync(join(A, '_history'), { recursive: true });
writeFileSync(join(A, '_history', '0e7e0001.jsonl'), '{"seq":1,"by":"base"}\n');
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
await sync.syncNow(noop);
writeFileSync(join(B, '_history', '0e7e0001.jsonl'), '{"seq":1,"by":"base"}\n{"seq":2,"by":"B"}\n');
await sync.commitSaved();
A = side('A');
switchDocument('Scratch A.md');
writeFileSync(join(A, '_history', '0e7e0001.jsonl'), '{"seq":1,"by":"base"}\n{"seq":2,"by":"A"}\n');
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
r = await sync.syncNow(noop);
const log = read(B, '_history/0e7e0001.jsonl');
assert(log.includes('"by":"A"') && log.includes('"by":"B"') && !log.includes('<<<<') && !r.conflicts, 'both devices\' lines are kept, no copy');
assert(read(B, '.gitattributes').includes('_history/*.jsonl merge=union'), 'the union rule travels with the documents');

console.log('\nTwo devices decide the same suggested change differently: the later decision wins:');
const proposal = (status) => ({
  version: 1,
  entries: [{
    nodeId: 'p2', status,
    originalBaseline: { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Second, as written.' }] },
    newContent: { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Second, as suggested.' }] },
  }],
});
A = side('A');
switchDocument('Scratch A.md');
writeDoc(A, 'Review.md', 'Review', 'aeaee001', ['First.', 'Second, as written.']);
mkdirSync(join(A, '_pending'), { recursive: true });
writeFileSync(join(A, '_pending', 'aeaee001.json'), JSON.stringify(proposal('rewrite'), null, 2));
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
await sync.syncNow(noop);
// B rejects later, and an agent adds a new suggestion there.
const newer = proposal('rewrite');
newer.entries = [{ nodeId: 'p3', status: 'insert', afterNodeId: 'p2', newContent: { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'A third.' }] } }];
await editAt(T + 600, () => writeFileSync(join(B, '_pending', 'aeaee001.json'), JSON.stringify(newer, null, 2)));
A = side('A');
switchDocument('Scratch A.md');
await editAt(T + 500, () => {
  writeDoc(A, 'Review.md', 'Review', 'aeaee001', ['First.', 'Second, as suggested.']);
  unlinkSync(join(A, '_pending', 'aeaee001.json'));
});
await sync.syncNow(noop);
B = side('B');
switchDocument('Scratch B.md');
r = await sync.syncNow(noop);
assert(read(B, 'Review.md').includes('Second, as written.') && !read(B, 'Review.md').includes('as suggested'), "B's later reject wins over A's earlier accept");
const pend = JSON.parse(read(B, '_pending/aeaee001.json'));
assert(!pend.entries.some((e) => e.nodeId === 'p2'), 'the decided change is not brought back');
assert(pend.entries.some((e) => e.nodeId === 'p3'), 'the new suggestion is kept');
A = side('A');
switchDocument('Scratch A.md');
await sync.syncNow(noop);
assert(read(A, 'Review.md').includes('Second, as written.'), 'A ends with the later decision too');

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

console.log('\nThe open doc deleted on another device closes, with Undo:');
B = side('B');
switchDocument('Essay.md');
await sync.syncNow(noop);
A = side('A');
switchDocument('Scratch A.md');
await sync.syncNow(noop);
unlinkSync(join(A, 'Essay.md'));
await sync.syncNow(noop);
B = side('B');
switchDocument('Essay.md');
r = await sync.syncNow(noop);
assert(r.state === 'synced' || r.state === 'pending', 'B syncs');
assert(!existsSync(join(B, 'Essay.md')), 'the deleted document is not brought back');
assert(getActiveFilename() !== 'Essay.md', 'B moves to another document');
n = (await notices()).find((x) => x.kind === 'deleted');
assert(n && n.device === "Maya's laptop" && n.title === 'Essay', `B is told where it was deleted (${JSON.stringify(n)})`);
const undone = await sync.undoNotice(n.id, noop);
assert(undone.ok && undone.filename === 'Essay.md' && read(B, 'Essay.md').includes('live update'), 'Undo brings it back');
await sync.syncNow(noop);
A = side('A');
await sync.syncNow(noop);
assert(existsSync(join(A, 'Essay.md')), 'and every device gets it back');

console.log('\nConnecting a folder that already has writing merges, never overwrites:');
const C = side('C');
writeDoc(C, 'Notes.md', 'Notes', '0e7e0001', ['Notes from a third copy.']);
writeDoc(C, 'Own.md', 'Own', 'c0c00002', ['Only here.']);
// C's writing is the newest of all.
process.env.GIT_AUTHOR_DATE = `${T + 900} +0000`;
const copies = await sync.connectExisting(remote);
delete process.env.GIT_AUTHOR_DATE;
assert(copies.length === 0 && !readdirSync(C).some((f) => f.includes('from GitHub')), 'no conflict copies');
assert(read(C, 'Notes.md').includes('third copy'), "C's newer Notes.md is kept");
assert(git(C, 'log', '--all', '-p', '--', 'Notes.md').includes('End from A.'), "GitHub's version stays in history");
assert(existsSync(join(C, 'Own.md')) && existsSync(join(C, 'Essay.md')), "C keeps its own doc and gets GitHub's");

console.log('\nA save is committed here at once, offline too, signed by the device:');
A = side('A');
switchDocument('Scratch A.md');
writeDoc(A, 'Notes.md', 'Notes', '0e7e0001', ['Notes written on A.', 'A saved paragraph.']);
assert(await sync.commitSaved(), 'the save is committed without GitHub');
assert(git(A, 'log', '-1', '--format=%an') === "Maya's laptop" && git(A, 'status', '--porcelain') === '', 'committed as the device, nothing left over');
await sync.syncNow(noop);

console.log("\nThe app's own files never sync:");
writeFileSync(join(A, '.first-run'), '2026-10-23T00:00:00.000Z\nStart here.md\n');
writeDoc(A, 'Start here.md', 'Start here', '5a5a0001', ['Welcome to OpenWriter.']);
writeFileSync(join(A, 'server.lock'), '{"pid":1}');
writeFileSync(join(A, 'config.json'), '{}');
mkdirSync(join(A, 'voice'), { recursive: true });
writeFileSync(join(A, 'voice', 'index.db'), 'SQLite format 3');
// An older version committed the lock file and the voice index; they leave GitHub but stay here.
execFileSync('git', ['add', '-f', 'server.lock', 'voice/index.db'], { cwd: A });
execFileSync('git', ['-c', 'user.name=old', '-c', 'user.email=old@x', 'commit', '-q', '-m', 'old'], { cwd: A });
r = await sync.syncNow(noop);
assert(r.state === 'synced', 'A syncs');
const onGitHub = git(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
for (const f of ['.first-run', 'Start here.md', 'server.lock', 'config.json', '.openwriter-device.json', 'voice/index.db']) {
  assert(!onGitHub.includes(f), `${f} is not on GitHub`);
}
assert(existsSync(join(A, 'server.lock')) && existsSync(join(A, 'Start here.md')) && existsSync(join(A, 'voice', 'index.db')), 'and they stay on this copy');
B = side('B');
writeFileSync(join(B, 'server.lock'), '{"pid":2}');
await sync.syncNow(noop);
assert(read(B, 'server.lock') === '{"pid":2}', "another copy's lock file is untouched by the pull");

console.log('\nA pull waits while the writer types:');
debouncedSave('human');
r = await sync.pullNow(noop);
assert(r.deferred === true, 'the pull is put off while typing');
cancelDebouncedSave();

console.log('\nFailures read as the writer would say them:');
assert(sync.describeSyncError('fatal: unable to access https://github.com/x/y.git/: Could not resolve host: github.com').state === 'offline', 'no network is offline, not an error');
const auth = sync.describeSyncError("remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/x/y.git/'");
assert(auth.error === 'GitHub sign-in expired' && auth.fix === 'signin', 'a refused sign-in says so and offers sign-in');

console.log('\nHistory from every device, with restore:');
A = side('A');
switchDocument('Scratch A.md');
await sync.syncNow(noop);
const hist = await sync.docHistory('0e7e0001');
assert(hist.length >= 3 && hist.some((v) => v.device === 'Web') && hist.some((v) => v.device === "Maya's laptop"), `history names each version's device (${hist.length} versions)`);
const older = hist.find((v) => git(A, 'show', `${v.sha}:Notes.md`).includes('Middle from B, offline.'));
const headBefore = git(A, 'rev-parse', 'HEAD');
assert((await sync.restoreDocVersion('0e7e0001', older.sha, noop)).ok, 'restore works');
assert(read(A, 'Notes.md').includes('Middle from B, offline.'), 'the document has that version again');
assert(git(A, 'rev-parse', 'HEAD^') === headBefore, 'restoring is a new change on top');

console.log('\nRoll back everything to a time:');
await sync.syncNow(noop);
const mark = new Date(Date.now() + 2000);
// Later work, after the chosen time.
process.env.GIT_AUTHOR_DATE = `${Math.floor(mark.getTime() / 1000) + 60} +0000`;
process.env.GIT_COMMITTER_DATE = process.env.GIT_AUTHOR_DATE;
writeDoc(A, 'Notes.md', 'Notes', '0e7e0001', ['Rewritten later.']);
writeDoc(A, 'Later.md', 'Later', '1a7e0001', ['Made after the chosen time.']);
await sync.commitSaved();
delete process.env.GIT_AUTHOR_DATE;
delete process.env.GIT_COMMITTER_DATE;
const preview = await sync.rollbackPreview(mark.toISOString());
assert(preview.ok && preview.documents.length === 2 && preview.documents.includes('Notes') && preview.documents.includes('Later'), `preview lists the 2 documents that change (${JSON.stringify(preview)})`);
const rolled = await sync.rollbackTo(mark.toISOString(), noop);
assert(rolled.ok, 'roll back works');
assert(!read(A, 'Notes.md').includes('Rewritten later.') && !existsSync(join(A, 'Later.md')), 'every document is as it was');
assert(git(A, 'log', '-1', '--format=%s').startsWith('Roll back to'), 'the roll back is a new change');
assert(git(A, 'show', 'HEAD^:Notes.md').includes('Rewritten later.'), 'so the roll back can itself be undone');

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
