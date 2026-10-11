# GitHub is a two-way bridge, and a pull never loses writing

## Context

A writer can run OpenWriter in two places: the local app and a private online copy
(hosted mode, one Fly.io Machine per writer, see `adr/hosted-gateway-trust.md`). One
GitHub repo holds their documents, and both copies sync with it. The github plugin
(`plugins/github/src/git-sync.ts`) used to be a one-way backup: commit the data folder
and push. Two copies pushing to one repo without pulling would reject each other's
pushes, and an online copy that starts empty would never see the writer's documents.

Git's own merge is the right engine for text, but its failure modes are wrong for a
writer: a conflict leaves markers in the file or stops the sync, and a merge can
delete a file the writer has open. The rules below keep git's merge and replace those
failure modes with ones that never drop a word.

## Current invariants

- **Sync is commit, fetch, merge, push** (`runSync`). This side's work is saved
  (`save()`) and committed before anything is fetched, so every local edit is in a
  commit before a merge can touch the folder.
- **A file both sides changed that git cannot merge keeps this side's version in
  place.** GitHub's version is written next to it and committed:
  - a document `Name.md` becomes `Name (from GitHub YYYY-MM-DD HHMM).md`, with a new
    `docId` and the same suffix on its title, so it opens as its own document and
    never shares the original's id, pending sidecar or history;
  - any other file (workspace manifests, images) goes under
    `.sync-conflicts/<stamp>/<path>`, so the app never loads it as a second
    workspace or doc.
  The sync result and `/api/sync/status` carry the copies in `conflicts`; the Sync
  button lists them.
- **Edits beat deletes.** A file deleted on one side and changed on the other is kept
  with the change (git's modify/delete conflict, settled to the side that has it).
  A file deleted on one side and untouched on the other follows git and is deleted,
  except the document open in the editor: it is written back from memory and
  recommitted (`reloadChangedFiles` returns it as `restoredActive`).
- **First connection.** Connecting a repo merges with
  `--allow-unrelated-histories`. When the data folder has no writing yet (every
  `.md` body is empty), GitHub's files win outright (`-X theirs`), so the app's own
  starter files never shadow the writer's. A folder with writing merges normally and
  conflicts become copies. Nothing is overwritten.
- **The running server picks up a pull without a restart.** `reloadChangedFiles` in
  `server/state.ts` drops the cache entry of every changed file, reloads the active
  doc like an external write (`document-reloaded` to its tabs), pushes other docs to
  their viewers (`onDocFileWritten`), and the plugin then broadcasts the document
  list, workspaces and pending docs.
- **One sync at a time.** A second call waits for the running one, then runs (so a Sync
  click during the start-up pull still pushes).
- **Credentials.** One token store: `<root>/github-token.json` (outside the synced
  folder, mode 0600), written by device flow or a pasted PAT; an older install's
  `config.gitPat` is read until a new token replaces it. Every fetch and push gets the
  token through the inline credential helper and `OW_GIT_PAT` env var. It is never in
  the remote URL, `.git/config`, argv or logs. Network git never prompts
  (`GIT_TERMINAL_PROMPT=0`).
- **Device flow** (`device-flow.ts`) needs only the public `OW_GITHUB_CLIENT_ID` of a
  GitHub OAuth App with device flow enabled; there is no client secret. The browser
  polls `/api/sync/device/poll`; the server runs no timer.
- **Online copy.** Hosted mode loads the github plugin for docs sync only: no blog
  tools, and the plugin is enabled at boot. It pulls once at start-up (commit and
  merge, no push; machines wake from sleep often) and on every Sync click. No
  background timers.

## Decision log

### 2026-10-10 — two-way sync with conflict copies
Chosen: git merge plus a conflict-copy rule, over last-writer-wins (loses the other
side's text) and over leaving conflict markers (writes git syntax into prose and
breaks the frontmatter). Conflict copies are committed so the other copy gets them on
its next sync and the writer can settle them from either place. Pull is
writer-triggered (Sync) plus once at start-up, never on a timer: a Machine that stops
when idle would wake for nothing, and a timer merging under an open editor is the
race this design avoids. The client id comes from `OW_GITHUB_CLIENT_ID` because
`openwriter-publish` has no code using a GitHub App or OAuth App today; the operator
creates an OAuth App with device flow enabled and sets the id on the Fly app.
