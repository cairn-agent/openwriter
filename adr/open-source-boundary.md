# Open source is the local app; the web version lives elsewhere

## Context

OpenWriter has two forms. The open-source app in this repository (MIT, published to npm as
`openwriter`) is the copy a writer runs on their own computer and adds to their own desktop or
terminal agent. OpenWriter on the web is a separate, paid product: it is not in this repository
and not in the npm package.

On 2026-10-10 parts of the web version were built directly into this repository behind an
environment switch. On 2026-10-11 they moved out, and what the web version needs from this code
became generic extension points that local plugin authors can use too. The commits that added
them stay in the public history; that cannot be undone and they hold no secrets.

## Current invariants

- **This repository holds only the local app**: its editor, its MCP tools, and the plugins a
  local writer runs. No code, test or doc here exists only to run OpenWriter online.
- **Shared needs become generic extension points, never web behaviour.** Each one must make sense
  for a local plugin author or someone embedding OpenWriter in their own program. When it is
  unclear which side something belongs on, it stays out of this repository.
- **The extension points** (all off by default; the local app behaves as before without them):
  - **Data folder**: `OW_DATA_DIR` moves everything that lives in `~/.openwriter`
    (`server/helpers.ts`, read once at load).
  - **Embedding**: `startOpenWriter(options)` (`server/embed.ts`, package export
    `openwriter/server`) starts the server inside another program on a chosen host and port.
    It runs the server only: no client mode, no stdio MCP, no `server.lock`, no browser
    launch; the embedder owns the process and gives it its own data folder.
  - **Request gate**: `requestGate(req)` sees every HTTP request and WebSocket upgrade and may
    refuse it with a status and JSON body. When set it replaces the loopback Host check, never
    sits beside a skipped one (`server/security-gate.ts`, `server/ws.ts`).
  - **Public origin**: `publicOrigin` replaces the loopback Origin check for state-changing
    requests and WebSockets, and is the base URL the server hands out.
  - **Tool filter**: `toolFilter({ name, plugin })` removes tools from every list: the built-in
    registry at start, and each plugin's tools when it is enabled.
  - **Plugin filter**: `pluginFilter({ name, source })` decides which discovered plugins exist.
  - **In-process plugins**: `plugins` passes plugin objects directly; they load beside the
    discovered ones and are enabled at start, as are the discovered names in `enable`. They are
    part of the embedding program: the plugin list shows their `displayName` and no switch, and
    `disable()` refuses them.
  - **Plugin host**: `PluginHost` (`server/plugin-types.ts`) gives a plugin `saveConfig`,
    `createDocument`, `tools()` (the live tool list, to run OpenWriter's own tools in-process),
    `pendingDocs()` and `rootDir`. A plugin never calls its own server over HTTP.
  - **Client modules**: a plugin's `clientModule: { dir, entry }` is served under
    `/plugin-client/<plugin>/` and imported by the browser at page load. Its default export
    receives the client plugin API (`src/plugins/client-plugins.tsx`): right-rail tabs
    (optionally with a titlebar toggle, optionally holding the rail open while pending changes
    arrive), context-menu panels over a text selection, `openRailTab`, `showToast` and
    `onConnectionLost`. A client module mounts its own UI into the element it is given.
    A module presenting the app its own way also gets what the app shows (`getApp`,
    `onAppChange`: the editor, the open document, the connection, unsent edits, pending
    documents), the app's own actions (`app`: switch, create, flush, rename, and review's
    accept/reject, focus and original preview, through the same code the Review tab uses),
    the app's ProseMirror classes (`pm`) for its editor plugins and decorations, and `tabId`.

## Decision log

### 2026-10-11 — web-only code moved out; generic extension points in its place
Rule ratified by the operator: everything on the web is the paid version and never goes in this
repository or the npm package. The environment switch, every branch on it, the web version's
request trust, packaging, browser redirects, interface and their dependencies, tests and ADRs
left this repository. Kept as generic: the data folder setting, the plugin host, two-way GitHub
sync with device-flow sign-in, and the plugin data-folder fixes. The github plugin's start-up
pull became an opt-in setting (`pullOnStart`, env `OW_GITHUB_PULL_ON_START`). Client modules
mount into a plain element rather than sharing the app's React, so a module can use any UI
library and cannot break the app's own tree. Discovered plugins load client modules only at page
load: enabling one later shows its interface after a reload.

### 2026-10-11 — the app bridge for client modules; in-process plugins are required
A client module could add a tab or a menu panel but could not see the open document or drive
navigation and review, so a different presentation of the app (a phone layout, a reader view)
had to fork the app. The client plugin API now carries a snapshot of what the app shows, its
actions, and its own ProseMirror classes: decorations built from a second copy of ProseMirror are
not recognised by the editor. Review actions run through `decorations/review-actions.ts`, shared
with the Review tab, so there is one way to settle a document's review. An in-process plugin is
the embedder's own code: switching it off from the plugin list took down the embedder's routes,
so the list shows its own name and no switch, and the server refuses to disable it.
