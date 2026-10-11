# Hosted mode trusts only the gateway's signed identity

## Context

The web app at openwriter.io runs one private copy of this server per writer, each on its own
Fly.io Machine with its own volume. A Cloudflare Worker (the gateway, in `openwriter-publish`)
signs the writer in at `app.openwriter.io` and proxies their HTTP and WebSocket traffic to their
machine.

Locally the server has no authentication at all: it binds to loopback and its only boundary is
the Host/Origin check in `securityGate` (`server/index.ts`) and the WebSocket `verifyClient`
(`server/ws.ts`). A hosted machine listens on `0.0.0.0` behind Fly's proxy, so that boundary means
nothing there: the Host header is whatever the proxy sends, and anyone who reaches the machine
could otherwise drive every route, including `/api/mcp-call`, which runs any tool.

## Current invariants

- **Hosted mode is `OW_HOSTED=1`, and nothing else turns it on.** Without it the server behaves
  exactly as the local app always has. `HOSTED` is read once in `server/helpers.ts`.
- **Hosted mode fails closed at boot.** It refuses to start without `OW_DATA_DIR`,
  `OW_GATEWAY_SECRET` and `OW_PUBLIC_URL`.
- **Every request and every WebSocket upgrade carries the gateway's signature** (`server/hosted.ts`):
  - `X-OW-User`: the writer's user id.
  - `X-OW-Timestamp`: unix seconds.
  - `X-OW-Gateway`: lowercase hex HMAC-SHA256, key `OW_GATEWAY_SECRET`, over `<user>.<timestamp>`.
  - Missing header, malformed or wrong signature, or a timestamp more than 60 s from the
    machine's clock: **401**. The signature is compared in constant time.
- **A machine serves exactly one writer.** The first verified user id is written to
  `<OW_DATA_DIR>/hosted-owner.json` (exclusive create). A verified request for any other user id
  gets **403**. The owner is never rewritten by the server; reassigning a volume is an operator act
  (delete the file).
- **The signature replaces the Host check; it never sits beside a skipped one.** In hosted mode
  the loopback Host allowlist is off and the gateway check is on, in the same `securityGate`.
  State-changing requests that carry an Origin or Referer must match `OW_PUBLIC_URL`'s origin
  (the CSRF half of the local gate, kept). WebSockets apply the same signature and Origin rule.
- **`GET /healthz` is the only unauthenticated route.** It answers 200 `ok` and nothing else, so
  Fly's checks need no secret.
- **Hosted tools are a fixed set.** Tools that reach the local machine (`open_file`,
  `reload_from_disk`, `export_manuscript` to a file path) are removed from `TOOL_REGISTRY`, so
  they are absent from every tool list. The x-api plugin is never discovered, and
  user-installed plugins are not scanned. The github plugin runs for docs sync only
  (`HOSTED_ENABLED_PLUGINS`, enabled at boot): its blog tools are absent and it registers
  only `/api/sync/*` routes (`adr/two-way-sync.md`). Profile create,
  switch, delete and restore routes answer 404; the profile is always `Default`.
- **No single-owner lock in hosted mode.** The machine runs one process. A failed port bind
  exits instead of falling back to client mode, `server.lock` is not taken (after a restart
  the old lock would name a pid that may now be this process's own port holder), and the stdio
  MCP server is not started.

- **Packaging.** `Dockerfile` builds the monorepo and runs `dist/bin/pad.js` with `OW_HOSTED=1`,
  `OW_DATA_DIR=/data`, `PORT=8080`; the runtime image includes `git` and `ca-certificates`
  for GitHub sync. `fly.toml` is a template for the `openwriter-writers` app:
  volume at `/data`, internal port 8080, machines stop when idle and start on request, `/healthz`
  check. `OW_GATEWAY_SECRET` is a Fly secret, never in the file.

## Decision log

### 2026-10-10 — gateway HMAC header, one writer per machine
Chosen: a per-request HMAC over user and timestamp with a shared secret, verified by the machine.
The gateway already holds the session; the machine only needs to know the request came through
it and for whom. Rejected: trusting Fly's private network alone (any Fly app in the org, or a
misrouted request, would be trusted as any writer) and mTLS (Cloudflare Workers cannot present
client certificates to an arbitrary origin without extra setup). The first-seen owner record
stops a gateway routing bug from opening one writer's machine to another; it is a second lock,
not the primary one. Replay inside the 60 s window is accepted: the headers only travel over the
gateway's TLS connection to Fly.

### 2026-10-10 — the github plugin returns for docs sync only
The online copy now syncs the writer's documents with GitHub, two ways (`adr/two-way-sync.md`).
`HOSTED_EXCLUDED_PLUGINS` drops `@openwriter/plugin-github`; the new `HOSTED_ENABLED_PLUGINS`
enables it at boot (`server/index.ts`). In hosted mode the plugin returns no MCP tools, so
`post_to_blog` and the other blog tools stay off, and its routes are the `/api/sync/*` set
(asserted in `scripts/test-hosted-mode.mjs`). They sit behind the same gateway check as every
other route. The Docker runtime stage installs `git` and `ca-certificates`.
