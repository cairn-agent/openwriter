# Visual editing of the existing book outline

## Context

An outline is an ordinary document of headings and document links. Requiring
writers to assemble those links through prose-link controls made manual book
assembly unnecessarily difficult. A visual chapter list must not become a
second source of truth or discard content that the compiler ignores.

## Current invariants

- Outline and Text share one mounted TipTap editor, history and save stream.
  The visual projection never serializes parseManifest back into the document.
- Chapter moves carry their full document slice, including nested headings,
  notes and references. Link actions identify occurrences, not just source IDs.
  Original source files are never modified by outline actions.
- Human removals carry their exact block identities through doc-update. The
  shared fidelity policy permits a large deletion only when every lost block
  was explicitly removed. This distinguishes intentional chapter removal from
  an editor mounting blank; ordinary snapshot protection stays in place.
- Structural operations resolve targets from the latest editor state. Pending
  proposals in an affected range must be reviewed first; unrelated ranges stay
  editable. Adding references retains a picker basket when its target disappears.
- A book build runs only after a save-view acknowledgment on the same WebSocket
  that carries normal edits. This barrier compares the shown document with the
  server's merged document, calls the existing save, and verifies the disk read.
  It does not accept a second browser-write path or queue a build across reconnect.
- Preflight uses the existing accepted-text compiler. Its revision binds the
  reviewed outline and compiled sources; changed input requires another review.
  Missing links cannot silently produce an incomplete manuscript.
- The built manuscript stays independent. Outline edits never synchronize it.
  Existing build, confirmation, chapter-add and export services remain authoritative.
- Creating from sidebar selection creates a blank outline in the background;
  the browser stages the selection before navigating normally. Selected source
  documents do not silently become separate chapters.

## Decision log

- 2026-10-16: A Book workspace's Build manuscript pin opens the existing outline
  review flow. It never bypasses the save barrier, source preflight or explicit
  build action, and opens an existing manuscript instead of making a duplicate.
  Creating an outline from a Files selection fills an empty outline attachment
  in its selected Book workspace, preserving the same selection basket flow.
  Attached briefs are excluded from the source picker. Workspace-change events
  refresh attachment roles while a picker is open, including its selected basket.

- 2026-10-16: Added the outline canvas, document picker, reversible structural
  transactions and accepted-text build review. Retained the original schema and
  compiler. Added an observed-save barrier instead of racing an HTTP build against
  a debounced browser save, and revision-checked the build to cover source edits
  during review. Tests exercise structural preservation, reference occurrences,
  Undo, pending overlap, accepted-text preflight and manuscript independence.
