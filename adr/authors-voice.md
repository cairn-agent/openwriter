# Author's Voice: right-click actions on the writer's own Claude key

Referenced by every module in `plugins/authors-voice/src`.

## Context

Author's Voice began as a separate product: a server (authors-voice.com) that kept a writer's
voice profile and writing samples and rewrote text through an API, metered by credits. The
document transforms (Vary, Shrinkify, Expandify, Threadify, Storify, Emailify, Postify) ran on
the publish server. Both are retired (2026-10-13, operator decision): Author's Voice is now only
right-click actions inside OpenWriter, each a call to Claude on the writer's own Anthropic key.
No API, no agent tools, no credits. Its prompts and engine are open source in this plugin, and
the web version of OpenWriter runs the same plugin (it keeps the key encrypted itself and hands
it over through `createAuthorsVoicePlugin({ loadKey })`).

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

- **Every model call runs on the writer's key** (`host.ts` `claude()`): the plugin setting
  `anthropic-api-key`, or the embedder's `loadKey`. No key: a plain "add your key" answer (409
  `no_key`). The key is never logged or shown; errors pass through `redactKey`.
- **Copied code keeps its text.** Changes to copied modules are limited to imports (file
  endings, the model caller) and the key. A prompt is never reworded here; to change one, change
  it at its source and copy it again.
- **The writer's documents are the corpus.** Right-click a document (or a folder) > Add to
  Author's Voice. Paragraphs are OpenWriter's own blocks read through `read_pad`, keyed by node
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
  response shape, so the editor's right-click menu is unchanged.
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
