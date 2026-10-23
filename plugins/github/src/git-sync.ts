/**
 * Git sync module: all git/gh CLI interactions for syncing the data folder
 * with a GitHub repo, both ways.
 * Lifted from packages/openwriter/server/git-sync.ts into the github plugin.
 *
 * Uses child_process.execFile with an argv array and NO shell (MCP-1): values
 * are passed to git/gh as literal arguments, never interpreted by a shell.
 * The GitHub token is supplied to authenticated fetches and pushes
 * out-of-band via an inline credential helper reading from an env var
 * (MCP-3) — it is never embedded in the remote URL, written to .git/config,
 * or placed in argv.
 * Server-internal modules (state, helpers, ws) accessed via getServerModules().
 *
 * Sync = commit this side, fetch, merge GitHub in, push. A merge never loses
 * writing: when both sides changed a file and git cannot merge it, this side's
 * file stays in place and GitHub's version is saved next to it as a conflict
 * copy. adr: adr/two-way-sync.md
 */

import { execFile } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, extname, join } from 'path';
import { getServerModules } from './helpers.js';
import { deviceFlowClientId } from './device-flow.js';

const GITIGNORE_CONTENT = `config.json\n.versions/\n`;
const NETWORK_TIMEOUT = 30000;
// Staging and committing a large backlog (hundreds of files, big logs and
// images) can take well over the 10s default; killing git mid-commit left the
// commit made but the push never run. Sync pushes use it too.
const LOCAL_WRITE_TIMEOUT = 300000;
/** GitHub's side of a non-document conflict lands here, so the app never loads it as a doc or workspace. */
const CONFLICT_DIR = '.sync-conflicts';
/** The token from device flow or a pasted PAT, outside the synced folder, owner-only. */
const TOKEN_FILE = 'github-token.json';
/** This copy's device name and id, in the data folder but never synced. */
const DEVICE_FILE = '.openwriter-device.json';
/** Committed to every documents repo, so another device can recognise it. */
const MARKER_FILE = '.openwriter';
/** The app's first-run marker; its later lines name the first-run documents (server/first-run.ts). */
const FIRST_RUN_MARKER = '.first-run';
/**
 * Files that belong to this copy only: settings, this device, the running
 * server's lock, local versions, and the first-run marker. Listed in
 * .git/info/exclude, which is never synced; the first-run documents join them.
 */
const LOCAL_ONLY = ['config.json', '.versions/', DEVICE_FILE, FIRST_RUN_MARKER, 'server.lock'];
/** When this copy last synced. Inside .git, so it is never synced either. */
const SYNC_META_FILE = 'openwriter-sync.json';
/** A pull waits while the writer typed this recently, so nothing changes under their cursor. */
const TYPING_MS = 3000;
/** Saves are committed this long after the last one: commit time is edit time. */
const COMMIT_DELAY_MS = 1500;
/** Changes go to GitHub this long after the writer stops. */
const PUSH_DELAY_MS = 20000;

export type SyncState = 'unconfigured' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncTime?: string;
  pendingFiles?: number;
  /** What went wrong, in the writer's words. */
  error?: string;
  /** What fixes it: sign in again, connect again, or try again. */
  fix?: 'signin' | 'setup' | 'retry';
  /** A pull that waited because the writer is typing; ask again after the pause. */
  deferred?: boolean;
  /** Conflict copies the last sync saved: files changed on both sides. */
  conflicts?: string[];
}

export interface SyncCapabilities {
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  existingRepo: boolean;
  remoteUrl?: string;
  /** A GitHub token is stored (device flow or PAT); setup can use it without asking again. */
  signedIn: boolean;
  /** "Sign in with GitHub" (device flow) is available. */
  deviceFlow: boolean;
  /** The name this copy signs its changes with, once chosen. */
  deviceName?: string;
}

export interface Device { id: string; name: string }

/** A GitHub repo that already holds OpenWriter documents. */
export interface DocsRepo { fullName: string; name: string; documents: number; private: boolean }

let currentSyncState: SyncState = 'unconfigured';
let lastError: { error: string; fix?: SyncStatus['fix'] } | undefined;
let lastConflicts: string[] = [];
/** One sync at a time: a second caller waits for the running one, then runs. */
let queue: Promise<unknown> = Promise.resolve();

// SECURITY (MCP-1): no shell. Arguments are passed to git/gh as an argv array,
// so each element is a single literal argument with no shell interpretation.
// The optional `env` is merged over the parent process env for that one call.
function exec(
  cmd: string,
  args: string[],
  cwd: string,
  timeout = 10000,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, timeout, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as any).killed) reject(new Error(`${cmd} ${args[0]} timed out after ${timeout / 1000}s`));
        else if (err) reject(new Error(stderr?.trim() || stdout?.trim() || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}

/** A blob's exact bytes (exec trims, which would change files). */
function gitBlob(sha: string, cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', ['cat-file', 'blob', sha], { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// ── Credential handling (MCP-3) ─────────────────────────────────────────────
// The token is supplied to authenticated git network calls WITHOUT ever
// touching the remote URL, .git/config, or argv. An inline credential helper
// (run by git through its own sh) reads the token from the OW_GIT_PAT env var
// at call time; only the variable *name* appears in arguments, never the
// secret itself.
const PAT_CRED_HELPER =
  '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$OW_GIT_PAT"; }; f';

/**
 * Run a git command that talks to the remote (fetch, push). With a token, the
 * `-c credential.helper=` first resets any inherited helper so only ours
 * answers; the token is passed via env, not argv. Without one, git's own
 * auth (gh, SSH, a credential manager) answers. Never prompts: a missing
 * credential fails instead of hanging the server.
 */
async function execGitRemote(args: string[], cwd: string, timeout = NETWORK_TIMEOUT): Promise<string> {
  const token = await readToken();
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
  if (!token) return exec('git', args, cwd, timeout, env);
  const authArgs = ['-c', 'credential.helper=', '-c', `credential.helper=${PAT_CRED_HELPER}`];
  return exec('git', [...authArgs, ...args], cwd, timeout, { ...env, OW_GIT_PAT: token });
}

// ── Token store ─────────────────────────────────────────────────────────────

async function tokenFile(): Promise<string> {
  return join((await getServerModules()).rootDir, TOKEN_FILE);
}

/** The stored GitHub token, if any. Older installs kept a PAT in config.json. */
export async function readToken(): Promise<string | undefined> {
  try {
    const token = JSON.parse(readFileSync(await tokenFile(), 'utf-8'))?.token;
    if (typeof token === 'string' && token) return token;
  } catch { /* no token file */ }
  const legacy = (await getServerModules()).readConfig()?.gitPat;
  return typeof legacy === 'string' && legacy ? legacy : undefined;
}

/** Store a token readable by this user only. Never logged, never in git config. */
export async function saveToken(token: string, source: 'device' | 'pat'): Promise<void> {
  const file = await tokenFile();
  writeFileSync(file, JSON.stringify({ token, source, savedAt: new Date().toISOString() }), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best-effort on filesystems without modes */ }
  const srv = await getServerModules();
  if (srv.readConfig()?.gitPat !== undefined) srv.saveConfig({ gitPat: undefined });
}

/**
 * Strip any embedded credentials (PAT / user:pass) from a git remote URL so a
 * credential-bearing URL is never returned to a client or logged. SSH scp-style
 * remotes (git@github.com:owner/repo.git) and local paths carry no secret and
 * are left as-is.
 */
export function sanitizeRemoteUrl(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    return u.toString();
  } catch {
    // Not parseable — defensively drop any userinfo that precedes an @ in a
    // scheme://… authority.
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
  }
}

async function dataDir(): Promise<string> {
  return (await getServerModules()).getDataDir();
}

// ── Device ──────────────────────────────────────────────────────────────────
// Every change this copy sends is signed with its device name (the commit
// author), so history and notices can say "Maya's laptop" or "Web". The id
// (the author email) tells this copy's own changes from another's even when
// two devices share a name. Stored in the data folder, never synced.

function cleanDeviceName(name: string): string {
  return name.replace(/[\r\n\t<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** This copy's device, if a name was chosen. */
export async function readDevice(): Promise<Device | null> {
  try {
    const d = JSON.parse(readFileSync(join(await dataDir(), DEVICE_FILE), 'utf-8'));
    if (typeof d?.id === 'string' && typeof d?.name === 'string' && d.name) return { id: d.id, name: d.name };
  } catch { /* not chosen yet */ }
  return null;
}

export async function saveDeviceName(name: string): Promise<Device> {
  const clean = cleanDeviceName(name) || 'OpenWriter';
  const id = (await readDevice())?.id || randomBytes(6).toString('hex');
  writeFileSync(join(await dataDir(), DEVICE_FILE), JSON.stringify({ id, name: clean }));
  return { id, name: clean };
}

async function device(): Promise<Device> {
  return (await readDevice()) || saveDeviceName(process.env.OW_GITHUB_DEVICE_NAME || 'OpenWriter');
}

/** `git -c user.name=<device> -c user.email=<id>@device.openwriter <args>`: this device signs the commit. */
async function gitAs(args: string[], dir: string, timeout = LOCAL_WRITE_TIMEOUT): Promise<string> {
  const d = await device();
  return exec('git', ['-c', `user.name=${d.name}`, '-c', `user.email=${d.id}@device.openwriter`, ...args], dir, timeout);
}

/** The name the setup screen offers: the hosting program's choice, else "<first name>'s computer". */
export function suggestDeviceName(githubName?: string): string {
  if (process.env.OW_GITHUB_DEVICE_NAME?.trim()) return process.env.OW_GITHUB_DEVICE_NAME.trim();
  const first = githubName?.trim().split(/\s+/)[0];
  return first ? `${first}'s computer` : 'My computer';
}

// ── Finding the writer's documents on GitHub ────────────────────────────────

async function githubApi(path: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** True when a repo's top-level listing looks like an OpenWriter data folder. */
function isDocsListing(entries: any[]): boolean {
  const names = new Set(entries.map((e) => e?.name));
  return names.has(MARKER_FILE) || names.has('_doc-order.json') || names.has('_workspaces') || names.has('_pending') || names.has('_history');
}

/**
 * The writer's GitHub repos that already hold OpenWriter documents, most
 * recently changed first, plus their name for the device suggestion. A second
 * device connects to one of these instead of creating another repo.
 */
export async function findDocsRepos(): Promise<{ login: string; name?: string; repos: DocsRepo[] }> {
  const token = await readToken();
  if (!token) throw new Error('Sign in with GitHub first');
  const user = await githubApi('/user', token);
  if (user.status === 401) throw new Error('GitHub sign-in expired. Sign in again.');
  if (user.status !== 200) throw new Error(`GitHub returned ${user.status}`);
  const list = await githubApi('/user/repos?per_page=100&sort=pushed&affiliation=owner', token);
  const all: any[] = Array.isArray(list.body) ? list.body : [];
  const repos: DocsRepo[] = [];
  // Look inside the 30 most recently changed repos, and always the default name.
  const candidates = all.filter((r, i) => i < 30 || r.name === 'openwriter-docs');
  await Promise.all(candidates.map(async (r) => {
    const root = await githubApi(`/repos/${r.full_name}/contents/`, token);
    const entries: any[] = Array.isArray(root.body) ? root.body : [];
    const empty = root.status === 404 && r.size === 0;
    if (!isDocsListing(entries) && !(empty && r.name === 'openwriter-docs')) return;
    const documents = entries.filter((e) => e?.type === 'file' && String(e.name).endsWith('.md')).length;
    repos.push({ fullName: r.full_name, name: r.name, documents, private: !!r.private });
  }));
  const order = new Map(all.map((r, i) => [r.full_name, i]));
  repos.sort((a, b) => (order.get(a.fullName) ?? 0) - (order.get(b.fullName) ?? 0));
  return { login: user.body?.login, name: user.body?.name || undefined, repos };
}

/** Connect a repo found by findDocsRepos (`owner/name`): the existing-repo path, no address to paste. */
export async function connectRepo(fullName: string): Promise<string[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error('Unknown repository');
  return connectExisting(`https://github.com/${fullName}.git`);
}

export async function isGitInstalled(): Promise<boolean> {
  try { await exec('git', ['--version'], await dataDir()); return true; } catch { return false; }
}

export async function isGhInstalled(): Promise<boolean> {
  try { await exec('gh', ['--version'], await dataDir()); return true; } catch { return false; }
}

export async function isGhAuthenticated(): Promise<boolean> {
  try { await exec('gh', ['auth', 'status'], await dataDir()); return true; } catch { return false; }
}

export async function isGitRepo(): Promise<boolean> {
  return existsSync(join(await dataDir(), '.git'));
}

async function ensureGitignore(): Promise<void> {
  const gitignorePath = join(await dataDir(), '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
  }
}

async function countPendingFiles(): Promise<number> {
  if (!(await isGitRepo())) return 0;
  try {
    const status = await exec('git', ['status', '--porcelain'], await dataDir());
    if (!status) return 0;
    return status.split('\n').filter(Boolean).length;
  } catch { return 0; }
}

export interface PendingFile {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  file: string;
}

export async function getPendingFiles(): Promise<PendingFile[]> {
  if (!(await isGitRepo())) return [];
  try {
    const output = await exec('git', ['status', '--porcelain'], await dataDir());
    if (!output) return [];
    return output.split('\n').filter(Boolean).map(line => {
      const code = line.substring(0, 2);
      const file = line.substring(3);
      let status: PendingFile['status'] = 'modified';
      if (code.includes('?') || code.includes('A')) status = 'added';
      else if (code.includes('D')) status = 'deleted';
      else if (code.includes('R')) status = 'renamed';
      return { status, file };
    });
  } catch { return []; }
}

/** This folder syncs when it is a git repo with a GitHub remote. Per folder, so each profile has its own. */
export async function isConfigured(): Promise<boolean> {
  if (!(await isGitRepo())) return false;
  try { await exec('git', ['remote', 'get-url', 'origin'], await dataDir()); return true; } catch { return false; }
}

async function readLastSync(dir: string): Promise<string | undefined> {
  try { return JSON.parse(readFileSync(join(dir, '.git', SYNC_META_FILE), 'utf-8')).lastSyncTime; } catch { return undefined; }
}

function writeLastSync(dir: string, time: string): void {
  try { writeFileSync(join(dir, '.git', SYNC_META_FILE), JSON.stringify({ lastSyncTime: time })); } catch { /* best-effort */ }
}

/**
 * A failed sync in the writer's words, with the fix. Never git output, never
 * a bare "Retry": no network is "offline" (work is saved here and goes up
 * later), a refused credential is an expired sign-in.
 */
export function describeSyncError(message: string): { state: 'offline' | 'error'; error: string; fix?: SyncStatus['fix'] } {
  if (/could not resolve host|unable to access|failed to connect|connection (refused|reset|timed out)|network is unreachable|timed out|getaddrinfo|ENOTFOUND|ECONNRESET/i.test(message)
    && !/(401|403)\b|authentication/i.test(message)) {
    return { state: 'offline', error: 'Offline, saved here, will sync' };
  }
  if (/authentication failed|could not read username|invalid username or password|bad credentials|terminal prompts disabled|\b(401|403)\b|permission to .* denied/i.test(message)) {
    return { state: 'error', error: 'GitHub sign-in expired', fix: 'signin' };
  }
  if (/repository not found|does not appear to be a git repository/i.test(message)) {
    return { state: 'error', error: 'Your documents are no longer on GitHub where they were', fix: 'setup' };
  }
  return { state: 'error', error: 'Could not sync with GitHub', fix: 'retry' };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  if (!(await isConfigured())) {
    return { state: 'unconfigured' };
  }

  if (currentSyncState === 'syncing') {
    return { state: 'syncing' };
  }

  const dir = await dataDir();
  const lastSyncTime = await readLastSync(dir);
  const conflicts = lastConflicts.length ? { conflicts: lastConflicts } : {};
  if ((currentSyncState === 'error' || currentSyncState === 'offline') && lastError) {
    return { state: currentSyncState, ...lastError, lastSyncTime, ...conflicts };
  }

  const pending = await countPendingFiles();
  return {
    state: pending > 0 ? 'pending' : 'synced',
    pendingFiles: pending,
    lastSyncTime,
    ...conflicts,
  };
}

export async function getCapabilities(): Promise<SyncCapabilities> {
  const [git, gh] = await Promise.all([isGitInstalled(), isGhInstalled()]);
  let ghAuth = false;
  if (gh) ghAuth = await isGhAuthenticated();

  let remoteUrl: string | undefined;
  if (await isGitRepo()) {
    try {
      // MCP-3: never expose embedded credentials. Even though the remote is
      // now stored credential-free, strip defensively so a legacy URL written
      // by an older build (PAT-in-URL) can't leak through this route.
      remoteUrl = sanitizeRemoteUrl(await exec('git', ['remote', 'get-url', 'origin'], await dataDir()));
    } catch { /* no remote */ }
  }

  return {
    gitInstalled: git,
    ghInstalled: gh,
    ghAuthenticated: ghAuth,
    existingRepo: await isGitRepo(),
    remoteUrl,
    signedIn: !!(await readToken()),
    deviceFlow: !!deviceFlowClientId(),
    deviceName: (await readDevice())?.name,
  };
}

/** The documents the app wrote on its first run ("Start here"), named in the marker's later lines. */
function firstRunDocuments(dir: string): string[] {
  try {
    return readFileSync(join(dir, FIRST_RUN_MARKER), 'utf-8').split(/\r?\n/).slice(1)
      .map((l) => l.trim()).filter((l) => l.endsWith('.md') && !/[\\/]/.test(l));
  } catch { return []; }
}

/** Every path that stays on this copy: the fixed list plus the first-run documents. */
function localOnlyPaths(dir: string): string[] {
  return [...LOCAL_ONLY, ...firstRunDocuments(dir).map((f) => `/${f}`)];
}

/**
 * This copy's own files stay out of every commit: .git/info/exclude is local
 * to this folder. One an older version committed is dropped from the repo
 * (the file itself stays here).
 */
async function ensureLocalExcludes(dir: string): Promise<void> {
  const file = join(dir, '.git', 'info', 'exclude');
  let current = '';
  try { current = readFileSync(file, 'utf-8'); } catch { mkdirSync(dirname(file), { recursive: true }); }
  const have = new Set(current.split(/\r?\n/));
  const paths = localOnlyPaths(dir);
  const missing = paths.filter((p) => !have.has(p));
  if (missing.length) writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  const files = paths.filter((p) => !p.endsWith('/')).map((p) => p.replace(/^\//, ''));
  await exec('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...files], dir);
}

/** This copy's own files as they are now, so a pull that drops them from the repo cannot remove them here. */
function snapshotLocalOnly(dir: string): Map<string, Buffer> {
  const saved = new Map<string, Buffer>();
  for (const p of localOnlyPaths(dir)) {
    if (p.endsWith('/')) continue;
    const path = join(dir, p.replace(/^\//, ''));
    try { saved.set(path, readFileSync(path)); } catch { /* not here */ }
  }
  return saved;
}

function restoreLocalOnly(saved: Map<string, Buffer>): void {
  for (const [path, bytes] of saved) if (!existsSync(path)) writeFileSync(path, bytes);
}

async function initRepo(): Promise<void> {
  const dir = await dataDir();
  if (!(await isGitRepo())) {
    await exec('git', ['init'], dir);
  }
  await ensureGitignore();
  await ensureLocalExcludes(dir);
  if (!existsSync(join(dir, MARKER_FILE))) {
    writeFileSync(join(dir, MARKER_FILE), 'This repository holds OpenWriter documents. OpenWriter keeps it in sync.\n');
  }
}

/** Stage everything and commit it as this device. False when there was nothing to commit. */
async function commitAll(dir: string, message: string): Promise<boolean> {
  await exec('git', ['add', '-A'], dir, LOCAL_WRITE_TIMEOUT);
  const status = await exec('git', ['status', '--porcelain'], dir, LOCAL_WRITE_TIMEOUT);
  if (!status) return false;
  await gitAs(['commit', '-m', message], dir);
  return true;
}

async function initialCommit(): Promise<void> {
  const dir = await dataDir();
  await commitAll(dir, 'Initial sync from OpenWriter');
  try { await exec('git', ['branch', '-M', 'main'], dir); } catch { /* no commit yet */ }
}

async function headSha(dir: string): Promise<string | null> {
  try { return await exec('git', ['rev-parse', '--verify', '-q', 'HEAD'], dir); } catch { return null; }
}

async function currentBranch(dir: string): Promise<string> {
  try { return await exec('git', ['symbolic-ref', '--short', 'HEAD'], dir); } catch { return 'main'; }
}

/** The fetched GitHub branch to merge: same name as ours, else main/master, else the only one. Null when GitHub is empty. */
async function remoteBranch(dir: string): Promise<string | null> {
  const out = await exec('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], dir);
  const branches = out.split('\n').map((b) => b.trim().replace(/^origin\//, '')).filter((b) => b && b !== 'HEAD' && b !== 'origin');
  if (branches.length === 0) return null;
  const ours = await currentBranch(dir);
  for (const b of [ours, 'main', 'master']) if (branches.includes(b)) return b;
  return branches[0];
}

/** True when any document in the folder has words in it (an empty starter draft does not count). */
function hasWriting(dir: string): boolean {
  const firstRun = new Set(firstRunDocuments(dir));
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || firstRun.has(name)) continue;
    const raw = readFileSync(join(dir, name), 'utf-8');
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    if (body.trim()) return true;
  }
  return false;
}

function conflictStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * GitHub's version of a document, renamed so it opens as its own doc: a new
 * docId (the original keeps its own) and the title marked as the GitHub copy.
 */
function asConflictCopy(raw: string, label: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return raw;
  const newId = randomBytes(4).toString('hex');
  let front: string;
  try {
    const meta = JSON.parse(m[1]);
    meta.docId = newId;
    if (typeof meta.title === 'string' && meta.title) meta.title = `${meta.title} (${label})`;
    front = JSON.stringify(meta);
  } catch {
    front = m[1]
      .replace(/^docId:.*$/m, `docId: ${newId}`)
      .replace(/^title:\s*(.+)$/m, (_l, t: string) => `title: ${JSON.stringify(`${t.replace(/^["']|["']$/g, '')} (${label})`)}`);
  }
  return `---\n${front}\n---${raw.slice(m[0].length)}`;
}

function freePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let i = 2; ; i++) if (!existsSync(`${stem} ${i}${ext}`)) return `${stem} ${i}${ext}`;
}

/**
 * Settle every file git could not merge, keeping all writing:
 *   both changed  → ours stays, GitHub's saved next to it as a conflict copy
 *   one deleted   → the side that still has the file wins (edits beat deletes)
 *   both deleted  → gone
 * Returns the conflict copies, relative to the data folder.
 */
async function settleConflicts(dir: string): Promise<string[]> {
  const out = await exec('git', ['ls-files', '-u', '-z'], dir);
  const stages = new Map<string, Map<number, string>>();
  for (const entry of out.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [, sha, stage] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (!stages.has(path)) stages.set(path, new Map());
    stages.get(path)!.set(Number(stage), sha);
  }

  const label = `from GitHub ${conflictStamp()}`;
  const copies: string[] = [];
  for (const [path, s] of stages) {
    const ours = s.get(2);
    const theirs = s.get(3);
    if (ours && theirs) {
      await exec('git', ['checkout', '--ours', '--', path], dir);
      const blob = await gitBlob(theirs, dir);
      const ext = extname(path);
      const copy = ext === '.md'
        ? freePath(join(dir, `${path.slice(0, -ext.length)} (${label})${ext}`))
        : freePath(join(dir, CONFLICT_DIR, label.replace(/ /g, '_'), path));
      mkdirSync(dirname(copy), { recursive: true });
      writeFileSync(copy, ext === '.md' ? asConflictCopy(blob.toString('utf-8'), label) : blob);
      const rel = copy.slice(dir.length + 1).replace(/\\/g, '/');
      await exec('git', ['add', '--', path, rel], dir);
      copies.push(rel);
    } else if (ours || theirs) {
      await exec('git', ['checkout', ours ? '--ours' : '--theirs', '--', path], dir);
      await exec('git', ['add', '--', path], dir);
    } else {
      await exec('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', path], dir);
    }
  }
  return copies;
}

interface PullResult {
  /** Files the merge changed here, absolute paths. */
  changed: string[];
  conflicts: string[];
}

/**
 * Merge the fetched GitHub branch into this side's committed work.
 *   'sync'    — the normal case, shared history.
 *   'connect' — first link of a folder with writing to a repo: histories may be unrelated.
 *   'fresh'   — first link of a folder with no writing yet: GitHub's files win outright,
 *               so the app's own starter files never shadow the writer's.
 */
async function mergeRemote(dir: string, mode: 'sync' | 'connect' | 'fresh'): Promise<PullResult> {
  const branch = await remoteBranch(dir);
  if (!branch) return { changed: [], conflicts: [] };
  const ref = `origin/${branch}`;
  const before = await headSha(dir);

  let conflicts: string[] = [];
  const args = ['merge', '--no-edit', '-m', 'Sync: merge from GitHub'];
  if (mode !== 'sync') args.push('--allow-unrelated-histories');
  if (mode === 'fresh') args.push('-X', 'theirs');
  try {
    await gitAs([...args, ref], dir);
  } catch (err) {
    // No unmerged files means the merge failed for another reason: undo it and surface it.
    if (!(await exec('git', ['ls-files', '-u'], dir))) {
      try { await exec('git', ['merge', '--abort'], dir); } catch { /* no merge in progress */ }
      throw err;
    }
    conflicts = await settleConflicts(dir);
    await gitAs(['commit', '--no-edit'], dir);
  }

  const after = await headSha(dir);
  if (!after || before === after) return { changed: [], conflicts };
  const diff = before
    ? await exec('git', ['diff', '--name-only', '-z', before, after], dir)
    : await exec('git', ['ls-tree', '-r', '--name-only', '-z', after], dir);
  const changed = diff.split('\0').filter(Boolean).map((p) => join(dir, p));
  return { changed, conflicts };
}

/** Make the running server show what the merge changed, and recommit the open doc if the merge deleted it. */
async function applyToServer(dir: string, changed: string[]): Promise<void> {
  if (changed.length === 0) return;
  const srv = await getServerModules();
  const { restoredActive } = srv.reloadChangedFiles(changed);
  if (restoredActive) await commitAll(dir, 'Sync: keep the open document');
  srv.broadcastDocumentsChanged();
  srv.broadcastWorkspacesChanged();
  srv.broadcastPendingDocsChanged();
}

async function pushBranch(dir: string, timeout = NETWORK_TIMEOUT): Promise<void> {
  await execGitRemote(['push', '-u', 'origin', await currentBranch(dir)], dir, timeout);
}

/** Point origin at `remoteUrl`, fetch, merge GitHub in, push. Shared by every setup path. */
async function connectRemote(remoteUrl: string): Promise<string[]> {
  const dir = await dataDir();
  const mode = hasWriting(dir) ? 'connect' : 'fresh';
  await initRepo();
  await initialCommit();

  try { await exec('git', ['remote', 'remove', 'origin'], dir); } catch { /* no remote */ }
  await exec('git', ['remote', 'add', 'origin', remoteUrl], dir);
  await execGitRemote(['fetch', 'origin'], dir, LOCAL_WRITE_TIMEOUT);

  // Take GitHub's branch name so the push lands on the branch we merged.
  const branch = await remoteBranch(dir);
  if (branch && branch !== (await currentBranch(dir))) await exec('git', ['branch', '-M', branch], dir);

  const saved = snapshotLocalOnly(dir);
  const { changed, conflicts } = await mergeRemote(dir, mode);
  restoreLocalOnly(saved);
  await applyToServer(dir, changed);
  await pushBranch(dir, LOCAL_WRITE_TIMEOUT);
  writeLastSync(dir, new Date().toISOString());
  lastConflicts = conflicts;
  lastError = undefined;
  return conflicts;
}

export async function setupWithGh(repoName: string, isPrivate: boolean): Promise<string[]> {
  const srv = await getServerModules();
  const dir = await dataDir();
  await initRepo();
  await initialCommit();

  const visibility = isPrivate ? '--private' : '--public';
  await exec('gh', ['repo', 'create', repoName, visibility, '--source=.', '--remote=origin'], dir, NETWORK_TIMEOUT);
  await exec('git', ['push', '-u', 'origin', 'main'], dir, NETWORK_TIMEOUT);
  writeLastSync(dir, new Date().toISOString());

  srv.saveConfig({
    gitConfigured: true,
    repoName,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
  lastConflicts = [];
  return [];
}

/**
 * Create a new GitHub repo with a token and sync into it. `pastedPat` is a PAT the
 * writer just typed, stored once the repo exists; otherwise the stored token is used.
 */
export async function setupWithToken(pastedPat: string | undefined, repoName: string, isPrivate: boolean): Promise<string[]> {
  const token = pastedPat || (await readToken());
  if (!token) throw new Error('Sign in with GitHub or paste a token first');
  const srv = await getServerModules();

  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: false }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || `GitHub API error: ${res.status}`);
  }

  const repo: any = await res.json();
  if (pastedPat) await saveToken(pastedPat, 'pat');
  // MCP-3: store a credential-free remote. The token is supplied per call via
  // the credential helper (execGitRemote), never embedded in the URL.
  const conflicts = await connectRemote(`https://github.com/${repo.full_name}.git`);

  srv.saveConfig({
    gitConfigured: true,
    repoName,
    gitRemote: repo.html_url,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
  return conflicts;
}

/**
 * Connect a repo that already exists and pull everything down. A folder with
 * no writing yet takes GitHub's files as they are (the online copy's first
 * connection); a folder with writing merges, and both-sides conflicts become
 * conflict copies. Nothing here is ever overwritten.
 */
export async function connectExisting(remoteUrl: string, pat?: string): Promise<string[]> {
  const srv = await getServerModules();
  if (pat) await saveToken(pat, 'pat');

  // MCP-3: keep the remote credential-free; never splice the PAT into the URL.
  // Strip any credentials the caller may have included before storing/using it.
  const finalUrl = sanitizeRemoteUrl(remoteUrl);
  const conflicts = await connectRemote(finalUrl);

  srv.saveConfig({
    gitConfigured: true,
    gitRemote: finalUrl,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
  return conflicts;
}

/** Run one git job after the one before it: syncs and local commits never overlap. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Two-way sync: save and commit this side, fetch, merge GitHub in, push.
 * `push: false` is a pull (the start-up catch-up); the merged result is
 * committed here and goes up with the next push.
 */
export function syncNow(onStatus: (status: SyncStatus) => void, opts: { push?: boolean } = {}): Promise<SyncStatus> {
  return enqueue(() => runSync(onStatus, opts.push !== false));
}

/** True while the writer typed in the last few seconds: no pull may change the folder under them. */
async function writerIsTyping(): Promise<boolean> {
  return (await getServerModules()).msSinceHumanEdit() < TYPING_MS;
}

/**
 * Catch up with GitHub (on open, on focus, before a document opens, every
 * minute while a browser is connected). While the writer is typing it waits
 * and says so (`deferred`), and the browser asks again after the pause.
 */
export async function pullNow(onStatus: (status: SyncStatus) => void): Promise<SyncStatus> {
  if (!(await isConfigured())) return { state: 'unconfigured' };
  if (await writerIsTyping()) return { ...(await getSyncStatus()), deferred: true };
  return syncNow(onStatus);
}

/** Commits ahead of GitHub's branch (everything, when GitHub has none yet). */
async function aheadOfGitHub(dir: string): Promise<boolean> {
  const branch = await remoteBranch(dir);
  if (!branch) return true;
  try { return Number(await exec('git', ['rev-list', '--count', `origin/${branch}..HEAD`], dir)) > 0; } catch { return true; }
}

async function runSync(onStatus: (status: SyncStatus) => void, push: boolean): Promise<SyncStatus> {
  const srv = await getServerModules();
  const dir = await dataDir();

  currentSyncState = 'syncing';
  onStatus({ state: 'syncing' });

  try {
    srv.cancelDebouncedSave();
    srv.save();

    await ensureGitignore();
    await ensureLocalExcludes(dir);
    await commitAll(dir, 'Edit');

    // A backlog fetch or push can carry many megabytes of images and history.
    await execGitRemote(['fetch', 'origin'], dir, LOCAL_WRITE_TIMEOUT);
    const saved = snapshotLocalOnly(dir);
    const { changed, conflicts } = await mergeRemote(dir, 'sync');
    restoreLocalOnly(saved);
    await applyToServer(dir, changed);
    if (push && (await aheadOfGitHub(dir))) await pushBranch(dir, LOCAL_WRITE_TIMEOUT);

    const now = new Date().toISOString();
    writeLastSync(dir, now);
    currentSyncState = 'synced';
    lastError = undefined;
    lastConflicts = conflicts;

    const result: SyncStatus = { ...(await getSyncStatus()), lastSyncTime: now };
    onStatus(result);
    return result;
  } catch (err: any) {
    console.error('[GitHub Plugin] sync failed:', err?.message || err);
    const { state, ...described } = describeSyncError(String(err?.message || err));
    currentSyncState = state;
    lastError = described;
    // Offline: what was saved here goes up as soon as GitHub can be reached.
    if (state === 'offline') schedulePush(onStatus, 60000);
    const result: SyncStatus = { state, ...described, lastSyncTime: await readLastSync(dir) };
    onStatus(result);
    return result;
  }
}

// ── Automatic sync ──────────────────────────────────────────────────────────
// Every save is committed here a moment later (offline too), so commit time is
// edit time. The writer's changes go to GitHub about 20 s after they stop.
// Nothing here repeats on its own: each timer is armed by a save, so a copy
// with no browser and no writing runs no timers and its machine can sleep.

let commitTimer: ReturnType<typeof setTimeout> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let watching: { dir: string; close: () => void } | null = null;

function schedulePush(onStatus: (status: SyncStatus) => void, delay = PUSH_DELAY_MS): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    if (await writerIsTyping()) { schedulePush(onStatus, 5000); return; }
    void syncNow(onStatus);
  }, delay);
}

/** Commit what was saved, as this device. No network: works offline. */
export function commitSaved(): Promise<boolean> {
  return enqueue(async () => {
    if (!(await isConfigured())) return false;
    return commitAll(await dataDir(), 'Edit');
  });
}

/** Path parts the folder watcher ignores: git's own files and this copy's local ones. */
function ignoredChange(rel: string): boolean {
  const first = rel.replace(/\\/g, '/').split('/')[0];
  return first === '.git' || first === '.versions' || first === DEVICE_FILE || first === 'server.lock' || first === CONFLICT_DIR;
}

/** A save landed in the data folder: commit it shortly, push after the pause. */
export function noteSaved(onStatus: (status: SyncStatus) => void): void {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(async () => {
    commitTimer = null;
    try {
      if (await commitSaved()) {
        onStatus(await getSyncStatus());
        schedulePush(onStatus);
      }
    } catch (err: any) {
      console.error('[GitHub Plugin] commit failed:', err?.message || err);
    }
  }, COMMIT_DELAY_MS);
}

/**
 * Watch the data folder of a synced copy and commit every save. One watcher;
 * started at boot and after setup. A platform without recursive watching
 * still syncs on open, focus, every minute and on close.
 */
export async function startAutoSync(onStatus: (status: SyncStatus) => void): Promise<void> {
  if (!(await isConfigured())) return;
  const dir = await dataDir();
  if (watching?.dir === dir) return;
  watching?.close();
  try {
    const w = watch(dir, { recursive: true, persistent: false }, (_event, name) => {
      if (name && !ignoredChange(String(name))) noteSaved(onStatus);
    });
    w.on('error', (err) => console.error('[GitHub Plugin] folder watch error:', err.message));
    watching = { dir, close: () => w.close() };
  } catch (err: any) {
    console.error('[GitHub Plugin] cannot watch the data folder; syncing on open and focus only:', err?.message || err);
  }
  // Anything saved while OpenWriter was closed goes up now.
  noteSaved(onStatus);
}
