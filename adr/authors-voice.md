# Writing in the writer's voice: right-click actions on their own Claude key

Referenced by every module in `packages/openwriter/server/voice/`, the menus that offer the
actions (`src/context-menu/ContextMenu.tsx`, `src/sidebar/DocContextMenu.tsx`) and Settings >
Claude (`src/right-rail/tabs/ClaudeSettings.tsx`). The file keeps its old name so existing
markers resolve.

## Context

Author's Voice began as a separate product: a server (authors-voice.com) that kept a writer's
voice profile and writing samples and rewrote text through an API, metered by credits. The
document transforms (Vary, Shrinkify, Expandify, Threadify, Storify, Emailify, Postify) ran on
the publish server. Both are retired (2026-10-13, operator decision): Author's Voice is now only
right-click actions inside OpenWriter, each a call to Claude on the writer's own Anthropic key.
No API, no agent tools, no credits. Since 2026-10-13 it is plain OpenWriter, not a plugin, and
the Author's Voice name is gone from the app: the actions keep their own names (Enhance, Shrink,
Vary...), the sidebar item is "Learn my voice from this", and the key lives in Settings > Claude.
The web version of OpenWriter keeps the key encrypted itself and hands it over through
`startOpenWriter({ aiKey })`.

The prompts are the refined part and are copied, never paraphrased:
- The editor (Enhance, Modify, Shrink, Expand, Insert, Fill paragraph, Fill sentence):
  Author's Voice's editorPromptBuilders, EditorPromptService instructions and size budgets,
  voicePrompts, the cadence directive and the selection markers (`editor/prompt.ts`).
- Enrichment of the writer's documents: the search engine's GR5 paragraph prompt and its document prompt
  (`voice/voice-prompts.ts`), on Haiku 4.5, temperature 0.
- Retrieval of voice examples: Author's Voice's production engine, coreRetrieve over the search engine's
  queryStore (`voice/voice-retrieve.ts`).
- The voice profile: Author's Voice's analysis (deterministic counts plus one Sonnet 4.6 call)
  and its author-blend matcher (Haiku 4.5), files copied as they are into `profile/`.
- The transforms: the publish server's transforms module, copied as it is into `transforms/`
  (Sonnet 4.5).

## Current invariants

- **Every model call runs on the writer's key** (`host.ts` `claude()`): saved in Settings >
  Claude to `<data root>/ai/claude.json` (owner-only, beside the usage log), or kept by the
  embedding program (`aiKey`, which also hides the key field). A key saved in the old plugin's
  settings is still read until the writer saves one here. No key: a plain "add your key" answer
  (409 `no_key`). The key is never logged, never sent to the browser (only its last four
  characters), and errors pass through `redactKey`.
- **Always on.** The routes are registered by the server itself (`registerVoiceRoutes`), and the
  menu items are built into the editor and sidebar menus, not listed by a plugin. `voice:`
  sidebar actions reach `/api/voice/sidebar-action` through the generic sidebar-action forwarder.
- **OpenWriter starts on any supported Node.** `node:sqlite` is loaded on first use of the voice
  index; only learning the voice and rewriting with examples need Node 22.5 or later.
- **Copied code keeps its text.** Changes to copied modules are limited to imports (file
  endings, the model caller) and the key. A prompt is never reworded here; to change one, change
  it at its source and copy it again.
- **The writer's documents are the corpus.** Right-click a document (or a folder) > Learn my
  voice from this. Paragraphs are OpenWriter's own blocks read through `read_pad`, keyed by node
  id, each tagged by who wrote it from OpenWriter's attribution (human -> Human, mixed ->
  AI-Assisted, agent -> AI, text from before attribution -> Human).
- **The index stores search terms, not the writing**: one SQLite file per profile,
  `<profile>/voice/index.db` (`node:sqlite`, Node 22.5 or later). Contentless FTS5 with English
  stemming; field weights text 1.0, headings 0.4, paragraph enrichment 0.3, document enrichment
  0.1 (the search engine uses 0 there and bridges with a word graph this index lacks; its own note says to
  raise it in that case). Re-adding a document enriches only paragraphs whose text changed.
- **The profile builds itself.** After an add, once the Human paragraphs reach Author's Voice's
  minimum (200 words), the analysis and the blend match run again over all of them and are
  saved to `<profile>/voice/profile.json`. Hand-written skill files in the same folder
  (anchor.md, coined-terms.md, fingerprints.md, stats.md) take precedence over it.
- **Rewrite** follows applyEditor: system examples from the whole document (cached five minutes
  per document, keyed on the voice's state), selection examples minus the system's and minus the
  paragraphs being rewritten. `POST /api/voice/apply-editor` keeps Author's Voice's request and
  response shape. Embedders with their own Rewrite UI call `runEditor` from `openwriter/server`.
- **Transforms** create a new document beside the source (a variant), as before.
- Usage is logged without text: `<data root>/ai/usage.jsonl`.

## Decision log

- **2026-10-13 — Moved into OpenWriter.** The engine, built first in the web version, moves here
  with the profile builder and the transforms; the plugin's old proxy to authors-voice.com and
  its billing routes are removed. Author's Voice kept every document in one store with
  per-document positions, so its adjacency rules crossed documents by accident; here they count
  within a document. The paragraphs being rewritten are never their own examples.
- **2026-10-13 — A host that supplies the key gets no settings.** With `loadKey`, the plugin
  declares no settings at all (it declared an empty list, which did not type-check as a plugin).
- **2026-10-13 — Plain OpenWriter, no plugin, no name.** Operator decision: a writer's own Claude
  key and these actions are core, so the plugin is gone. The code moved unchanged from
  `plugins/authors-voice/src` to `server/voice/`; the key moved from the plugin's settings to
  Settings > Claude; the embedder hook moved from `createAuthorsVoicePlugin({ loadKey })` to
  `startOpenWriter({ aiKey, aiClient })`. Also removed with it: the old Author's Voice credits
  panel and top-up toast (their billing routes were already gone), the `--api-key` / `--av-url`
  flags and `AV_API_KEY` (nothing read them), and the plugin's stale API skill docs.
