# AI runs on the writer's own Anthropic key: chat agent and inline edits

## Context

Phase 2 of the web app (`openwriter-publish/docs/web-app.md`) adds a chat box whose agent edits
documents and runs the publication, and inline rewrites of selected text. Operator decisions
(2026-10-10): the chat uses the Claude Agent SDK, not a hand-built loop; all AI runs on the
writer's own Anthropic API key (a Claude Max plan includes monthly API credit); OpenWriter never
pays for or sells AI and never offers claude.ai login; standalone Author's Voice is retired into
inline edits. The same code runs locally and in hosted mode (one Fly Machine per writer).

## Current invariants

(written with the implementation; see the decision log)

## Decision log

### 2026-10-10 — initial design
(in progress)
