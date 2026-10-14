---
version: 1
---
## X post body

**The body is exactly what gets posted.** X posts carry plain text, so the body has no headings, no bold or italic, no labels such as "Notes", "Beats", "Angle" or "Source", no source URL, and no commentary, options or scores. Notes and beats for a post live in a separate plain document (content_type "document"), never in this one.

**Paragraphs are separate nodes.** A blank line between paragraphs in markdown makes a new paragraph node, and the gap between paragraphs on X comes from that. A line break inside a paragraph with no gap is one hardBreak: a line ending in a backslash in markdown, or { type: "hardBreak" } between text nodes in TipTap JSON. Two hardBreaks in a row are split into separate paragraphs.

**Length.** X counts weighted characters: a URL is 23, an emoji 2. read_pad prints each paragraph's weighted count against 280 under it ("✓ 212/280", or "⚠ 301/280 (+21)"); the compose view counts the whole post. 280 per post is the limit for a standard X account; longer posts need X Premium.

**Images** are their own nodes. insert_image({ docId, afterNodeId, prompt, aspect_ratio }) generates one and inserts it as a pending change; several insert_image calls can run at once. An existing picture is copied into the _images folder of the active profile in the OpenWriter data folder, then inserted as ![alt text](/_images/name.png) or { type: "image", attrs: { src: "/_images/name.png", alt } }. Images at the end of a post, after its last paragraph, show as that post's attached media; an image before the text stays inline. Deleting a post's paragraphs leaves its images where they were.

**One document is one draft.** Another version of the post is a new document of the same content_type (and the same url), so the earlier draft stays to compare; a draft is never overwritten with a different version.

**Titles.** The default titles "Tweet", "Reply" and "Quote Tweet" are never replaced automatically (only "Untitled" is), and a sidebar of identical titles is unreadable, so a document still carrying one gets a short title naming its content, such as "Remote Work Myth QT", through rename_item. The writer accepts the staged rename.
