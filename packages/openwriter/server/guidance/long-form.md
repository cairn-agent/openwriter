---
version: 1
---
## Long-form body

**The body is the piece as readers get it**: paragraphs, ## and ### subheadings, bold and italic, links, blockquotes, lists, tables, horizontal rules and images. The title is not part of it (see the document's own contract). Notes, beats, outlines, sources, scores and commentary live in a separate plain document (content_type "document"), never in this one.

**Markdown in write_to_pad and populate_document becomes real nodes**: "## Heading" a heading, a line --- with a blank line on each side a horizontal rule, ![alt text](/_images/name.png) alone on its line an image, a line ending in a backslash a line break inside the paragraph. A --- directly under a line of text, with no blank line between, turns that line into a heading instead. edit_text's replace is plain text: markdown there lands as literal characters.

**Images** are their own nodes. insert_image({ docId, afterNodeId, prompt, alt, aspect_ratio }) generates one and inserts it as a pending change. An existing picture is copied into the _images folder of the active profile in the OpenWriter data folder and written as ![alt text](/_images/name.png). Publishing carries only pictures that exist in that folder; a /_images/ path with no file behind it is left out of what readers get.

**Pending changes are not published.** Agent writes, inserts and image inserts stay pending until the writer accepts them in the editor. Publishing and sending read the document with pending changes reverted, and neither refuses nor warns when some are left, so a piece published before the writer accepts goes out without them. get_pad_status({ docId }) reports what is pending.

**A paywall** is a line <!-- paywall --> on its own: everything above it is the free preview on an OpenWriter site (publish_to_site). One per document.
