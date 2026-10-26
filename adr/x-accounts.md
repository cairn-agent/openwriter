# Several X accounts: every post names its account

## Context

A profile can hold more than one X connection. The hosted publish server keys
connections on `(profile_id, provider, provider_user_id)`, so authorizing a second
X user inserts a second row; authorizing the same user again refreshes the
existing row. Until 2026-10-16 the local app assumed one: the Connections tab
showed one X row, and the browser Post path, article publishing, `post_to_x` and
`schedule_post` all took "the first active X connection". The publish server lists
connections newest first, so adding a second account would have silently moved
every post to the newest one.

Media ids are bound to the X API app that uploaded them. The x-api plugin uploads
with its own OAuth1 app; a platform connection uploads through the publish
server's app. A media id from one cannot be posted by the other.

## Current invariants

- **No post goes out from an account nobody picked.** Every X post path resolves
  its account the same way: an explicit connection id must be an active X
  connection; with no id, a lone account is used; two or more are refused with an
  error naming them. Local server: `resolveXConnection` in
  `packages/openwriter/server/connection-routes.ts`. MCP tools: `pickConnection`
  in `plugins/publish/src/index.ts`.
- **The account a document posts as is stored on the document**, as top-level
  metadata `xAccount` (a connection id). The tweet and article compose views read
  and write it through the account picker; `schedule_post` falls back to it when no
  `connection_id` is passed. A new document with several accounts
  connected has none until the writer picks.
- **Media follows the account.** When the browser posts with a `connectionId`, its
  images upload through `/api/x/upload-media` with that same id, which uploads via
  the platform account. Without a `connectionId` (no platform account), media and
  post both stay on the x-api plugin.
- **X shows whichever account is signed in on x.com.** X OAuth 2.0 has no
  documented forced-login parameter, so adding a second account means switching
  accounts on x.com first. The Connections tab says so next to "+ Add X account",
  and when a connect returns an account already listed it tells the writer they
  reconnected that account instead of adding one.

## Decision log

### 2026-10-16 — Multiple X accounts

Connections lists every X account with its own settings and disconnect, plus
"+ Add X account". `/api/x/status` returns `accounts`; `username` is set only when
there is exactly one. Compose views show an account picker when two or more are
connected and block Post until one is chosen. Platform-path media no longer
depends on the x-api plugin when an account is named.

### 2026-10-24 — Tools on the open document take a docId

`schedule_post` and the other publish tools that act on the open document now
take an optional `docId` (helpers.ts `withDocId`). Named, that document opens in
the editor first and is the one used, so the chat never publishes whatever
happened to be open. `schedule_post`'s account fallback then reads `xAccount`
from the named document.

### 2026-10-26 — X images read through core's imageFile

The platform-connection image upload (`uploadLocalImage` here, `uploadImages` in the
publish plugin) reads the image through `imageFile` instead of `_images/` directly, so
an online copy that keeps images on GitHub until shown still uploads them
(adr/two-way-sync.md). Account resolution is unchanged.
