---
version: 1
---
## X thread

**A thread is one document, divided into posts by horizontal rules.** The compose view gives each post its own editor and counter. A document with no rule is a single post; each rule starts the next post.

**A rule** is a markdown line --- with a blank line on each side, or the TipTap node { type: "horizontalRule" }. Both make the same node, in a markdown string or as a change of its own.

**A whole thread is written in one call**, so it arrives as one set of pending changes the writer reviews together:

    populate_document({ docId, content: "First post, first paragraph.\n\nFirst post, second paragraph.\n\n---\n\nSecond post.\n\n---\n\nThird post." })

or one write_to_pad call whose changes hold the same posts and rules in order, each appended with afterNodeId "end". afterNodeId "end" is always the end of the document.

**Adding a post mid-thread** is one insert after the last node of the post before it, starting with the rule: { operation: "insert", afterNodeId: "<last node of the previous post>", content: "---\n\nThe new post." }. Changes that share an afterNodeId land in the order they are listed.

**Each post's images** sit before the rule that ends it; trailing images become that post's attached media. Deleting a rule joins the two posts around it into one. Moving a post means moving its paragraphs and its images together.
