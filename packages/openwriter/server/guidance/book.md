---
version: 1
---
## Book workspace

A Book is an existing workspace with an attached brief and pinned Outline and Manuscript. Folders, beats, research and revisions keep their original identities and placements. Setting the workspace back to General preserves all documents and attachments. Workspace type is explicit configuration; schema and logline are descriptive enrichment, not instructions or editorial progress.

The attached brief records the author's direction: purpose, reader promise, audience, voice, form, settled decisions, evidence standards and open questions. It may link to existing documents instead of duplicating them. Its current accepted text arrives with these tools. The source revision list identifies changes since the last delivery. Relevant linked documents are read before writing; a stale snapshot or an unreviewed proposal is not an approved instruction. Conflicts between sources remain visible for the author to decide. A document shared by several books needs an explicit workspace context through get_item_context; the active browser tab never selects the book for the agent.

The agent owns the editorial work within the user's requested scope. A useful resume check reads the brief, the outline, the actual manuscript and unresolved author comments before naming the next chapter or edit. Structure and argument checks precede sentence polish; source and continuity checks support the affected passages; copyediting and proofing follow stable prose. These are passes performed on text, not manual workflow stages the writer maintains.

An editorial handoff states the scope and version actually read, the changes proposed, checks performed, unresolved questions and the next useful action. Prior pass results do not establish that subsequently changed text was checked. Completion comes from evidence of the pass, never a status label, elapsed time, a writing spinner or lack of pending changes. Opening a document supplies context; it does not authorize a new editing job.

Author-provided facts, scenes, research and voice remain book-specific material. Missing anecdotes or source support stay explicit gaps. Substantive changes to the author's argument are proposals for review; routine edits use the existing pending-change system. Optional review notes explain significant editorial choices beside an edit without repeating its wording. No bundled guidance contains a user's private book content.

configure_book_workspace attaches existing documents by stable docId. It creates no prose, moves no files and does not build a manuscript. The brief is attached to the workspace, outside the outline's chapter-source links, so it cannot accidentally be compiled as book text.
