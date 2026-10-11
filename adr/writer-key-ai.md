# AI runs on the writer's own Anthropic key: chat agent and inline edits

## Context

Phase 2 of the web app (`openwriter-publish/docs/web-app.md`) adds a chat box whose agent edits
documents and runs the publication, and inline rewrites of selected text. Operator decisions
(2026-10-10): the chat uses the Claude Agent SDK, not a hand-built loop; all AI runs on the
writer's own Anthropic API key (a Claude Max plan includes monthly API credit); OpenWriter never
pays for or sells AI and never offers claude.ai login; standalone Author's Voice is retired into
inline edits. The same code runs locally and in hosted mode (one Fly Machine per writer).

## Current invariants

**The key** (`server/ai/key-store.ts`)
- Lives only in `<data root>/ai/anthropic-key.json`, written owner-only (0600) through a temp
  file and rename. With `OW_KEY_SECRET` set (a Fly secret in hosted mode) it is encrypted with
  AES-256-GCM; without it (a local install) it is stored as is, protected by the file mode.
  A key encrypted under another secret reads as "saved but unusable" and the UI asks for it again.
- Never leaves the server. Routes return `{ saved, last4, savedAt, usable }` only. It is never
  logged; error text that might carry it goes through `redactKey`.
- Never enters `process.env`. Each chat passes it in the SDK query's own `env`, built from
  scratch: every variable whose name looks secret, and every `ANTHROPIC_*`, `CLAUDE*`, `OW_*`,
  `AV_*`, `PUBLISH_*` variable, is dropped first, so the agent cannot pick up another credential
  or endpoint. Inline edits build an Anthropic client per request with the key.
- No key: AI routes answer 409 `no_key` and the UI shows a short "add your key" prompt. Nothing
  else in the app depends on a key.

**The chat agent** (`server/ai/chat-runner.ts`, `chat-policy.ts`)
- One Agent SDK `query` per writer message, resumed from the conversation's SDK session.
- Built-ins off: `tools: []`, `settingSources: []`, its own config folder (`ai/agent-home`) and
  an empty working folder. The only tools are OpenWriter's `TOOL_REGISTRY`, served in-process as
  MCP server `openwriter`, minus `CHAT_EXCLUDED_TOOLS` (minion-only, local-file, account tools).
- Two guards stop the turn: the SDK's start-up report must say the credential came from
  `ANTHROPIC_API_KEY` (never a claude.ai login), and must list only our tools.
- `canUseTool` allows our own tools, denies everything else, and pauses risky ones for the
  writer: names starting `delete_`, `remove_`, `restore_`, `publish_`, `unpublish_`, `send_`,
  `resend_`, `post_to_`, `schedule_`, plus `manage_schedule`. The chat shows Allow / Cancel;
  stopping the turn cancels a pending question. A new tool with one of these verbs is covered by
  its name; a risky tool with another name must be added to the rule.
- Edits go through the same tool handlers as an external agent, so they land as pending changes.
  The runner counts pending changes per document around each tool call and reports
  "N changes proposed", which links into Review.
- History is per document: a conversation belongs to the document it started on, stored in the
  profile's `_chats/` folder; opening a document shows its latest conversation. A workspace-wide
  thread would mix unrelated documents and make "this document" ambiguous to the agent.

**Inline edits** (`server/ai/inline-edit.ts`, `inline-edit-prompt.ts`)
- A direct Messages API call with the writer's key, not the agent. Prompt is Author's Voice's
  editor prompt (selection markers, size budget, degrade prompt) ported as is; the voice profile
  is the Author's Voice skill files in `<profile>/voice/`. Result is applied through the
  `write_to_pad` handler, so it arrives as a pending change like any agent edit.
- Model ids live only in `server/ai/models.ts` (Opus, Sonnet, Haiku).

**Usage** (`server/ai/usage-log.ts`): one JSON line per chat turn and per inline edit in
`ai/usage.jsonl` (tokens, tool calls, cost the SDK reports). No billing.

**Hosting**: the Agent SDK runs a bundled Claude Code binary installed as a platform optional
dependency; the Docker build fails if it is missing. The agent process adds about 190 MB beside
the server's ~140 MB, so writer Machines get 1024 MB.

## Decision log

### 2026-10-10 — initial design

Built as above. Choices that looked interchangeable but are not:
- Key per query in `env`, not `process.env`: the server is one process serving the writer and
  its plugins; a process-wide key would leak into every child process and plugin.
- Risky tools by name prefix rather than a hand list: new publishing or deletion tools are
  caught without editing this rule.
- Tools load up front (`alwaysLoad`): deferred tool search is itself a built-in, which is off.
- Chat state in the browser lives in a module store (`src/ai/chat-session.ts`), because the rail
  unmounts tabs on switch and a streaming answer must survive that. The chat panel fills its box
  so a phone layout can show it full screen. While the chat tab is open, pending writes do not
  switch the rail to Review; the chat's own "N changes proposed" link does.
- Gap: hosted writers have no way yet to put voice profile files in `<profile>/voice/`; inline
  edits work without them, in a neutral voice.
Tests: `scripts/test-ai-key-and-inline-edit.mjs`, `scripts/test-ai-chat.mjs` (Anthropic mocked).
