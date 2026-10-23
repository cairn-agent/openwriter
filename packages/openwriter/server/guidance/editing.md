---
version: 2
---
## Editing and review notes

Agent block edits normally arrive as proposals the user can accept or reject.
`write_to_pad` and `edit_text` send only the blocks they change;
`populate_document` takes a whole body and is how a new document is filled.

A `rewrite` keeps the target block's type when its content is plain text: a
heading stays a heading at its level, a list item or quote stays one. Content
written as explicit markdown (`## Title`, `- item`) takes the type it names.
Rewriting a block that already has a pending proposal replaces that proposal:
it stays one change, judged against the block's accepted text, so the user need
not accept the first version before it is revised. A pending insert rewritten
stays an insert.
Each `write_to_pad` change can carry an optional `feedback` string, up to 500
characters. It appears as an Agent note beside that change in Review, and opens
from Agent note in Focus mode. The same note accompanies any additional blocks
produced by that change.

A useful note gives a brief editorial reason the reader needs to judge a
non-obvious choice: a change in meaning, a structural move, an uncertainty, or
a substantial cut. For example: "Removes a repeated example so the next section
can introduce the exception." Obvious spelling, punctuation and routine cleanup
usually need no note. Generic praise and descriptions such as "Improved clarity"
add noise. Notes are concise explanations for the reader, not private internal
reasoning or a step-by-step thought process.

A replacement block proposal replaces its note; omitting feedback clears the
previous note. Blank notes are omitted. Accepting or rejecting the change removes
the note. Notes survive save and reload only while pending, in the review sidecar;
they never become accepted prose or published content. Directly accepted edits
have no review note. `edit_text`, title proposals and ordinary comments do not
take this field. Putting an explanation into the document body would instead
make it part of the proposed writing.
