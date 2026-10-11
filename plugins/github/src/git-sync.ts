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
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
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

export type SyncState = 'unconfigured' | 'synced' | 'pending' | 'syncing' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncTime?: string;
  pendingFiles?: number;
  error?: string;
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
  /** "Sign in with GitHub" (device flow) is available: OW_GITHUB_CLIENT_ID is set. */
  deviceFlow: boolean;
}

let currentSyncState: SyncState = 'unconfigured';
let lastError: string | undefined;
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

export async function getSyncStatus(): Promise<SyncStatus> {
  const srv = await getServerModules();
  const config = srv.readConfig();

  if (!config.gitConfigured || !(await isGitRepo())) {
    return { state: 'unconfigured' };
  }

  if (currentSyncState === 'syncing') {
    return { state: 'syncing' };
  }

  const conflicts = lastConflicts.length ? { conflicts: lastConflicts } : {};
  if (currentSyncState === 'error' && lastError) {
    return { state: 'error', error: lastError, lastSyncTime: config.lastSyncTime, ...conflicts };
  }

  const pending = await countPendingFiles();
  return {
    state: pending > 0 ? 'pending' : 'synced',
    pendingFiles: pending,
    lastSyncTime: config.lastSyncTime,
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
  };
}

async function initRepo(): Promise<void> {
  const dir = await dataDir();
  if (!(await isGitRepo())) {
    await exec('git', ['init'], dir);
  }
  await ensureGitignore();
  try { await exec('git', ['config', 'user.name'], dir); } catch {
    await exec('git', ['config', 'user.name', 'OpenWriter'], dir);
  }
  try { await exec('git', ['config', 'user.email'], dir); } catch {
    await exec('git', ['config', 'user.email', 'openwriter@local'], dir);
  }
}

/** Stage everything and commit it. False when there was nothing to commit. */
async function commitAll(dir: string, message: string): Promise<boolean> {
  await exec('git', ['add', '-A'], dir, LOCAL_WRITE_TIMEOUT);
  const status = await exec('git', ['status', '--porcelain'], dir, LOCAL_WRITE_TIMEOUT);
  if (!status) return false;
  await exec('git', ['commit', '-m', message], dir, LOCAL_WRITE_TIMEOUT);
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
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
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
    await exec('git', [...args, ref], dir, LOCAL_WRITE_TIMEOUT);
  } catch (err) {
    // No unmerged files means the merge failed for another reason: undo it and surface it.
    if (!(await exec('git', ['ls-files', '-u'], dir))) {
      try { await exec('git', ['merge', '--abort'], dir); } catch { /* no merge in progress */ }
      throw err;
    }
    conflicts = await settleConflicts(dir);
    await exec('git', ['commit', '--no-edit'], dir, LOCAL_WRITE_TIMEOUT);
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

  const { changed, conflicts } = await mergeRemote(dir, mode);
  await applyToServer(dir, changed);
  await pushBranch(dir, LOCAL_WRITE_TIMEOUT);
  lastConflicts = conflicts;
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

/**
 * Two-way sync: save and commit this side, fetch, merge GitHub in, push.
 * `push: false` is a pull (the online copy's start-up catch-up); the merged
 * result is committed here and goes up on the next Sync.
 */
export function syncNow(onStatus: (status: SyncStatus) => void, opts: { push?: boolean } = {}): Promise<SyncStatus> {
  const run = queue.then(() => runSync(onStatus, opts.push !== false));
  queue = run.catch(() => undefined);
  return run;
}

async function runSync(onStatus: (status: SyncStatus) => void, push: boolean): Promise<SyncStatus> {
  const srv = await getServerModules();
  const dir = await dataDir();

  currentSyncState = 'syncing';
  lastError = undefined;
  onStatus({ state: 'syncing' });

  try {
    srv.cancelDebouncedSave();
    srv.save();

    await ensureGitignore();
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    await commitAll(dir, `Sync: ${timestamp}`);

    // A backlog fetch or push can carry many megabytes of images and history.
    await execGitRemote(['fetch', 'origin'], dir, LOCAL_WRITE_TIMEOUT);
    const { changed, conflicts } = await mergeRemote(dir, 'sync');
    await applyToServer(dir, changed);
    if (push) await pushBranch(dir, LOCAL_WRITE_TIMEOUT);

    const now = new Date().toISOString();
    srv.saveConfig({ lastSyncTime: now });
    currentSyncState = 'synced';
    lastConflicts = conflicts;

    const result: SyncStatus = { ...(await getSyncStatus()), lastSyncTime: now };
    onStatus(result);
    return result;
  } catch (err: any) {
    currentSyncState = 'error';
    lastError = err.message;
    const result: SyncStatus = { state: 'error', error: err.message };
    onStatus(result);
    return result;
  }
}
