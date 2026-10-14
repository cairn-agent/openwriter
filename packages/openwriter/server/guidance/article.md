---
version: 1
---
## X Article

This document is an X Article: content_type "article", metadata articleContext. The editor shows X's article layout: cover image, title, byline, then the body.

**The document title is the headline.** The body starts after it and never repeats it. A document still titled "Article" takes its title from the first line of the body on every save, so the headline is set with create_document's title or rename_item instead.

**The body is the article as it will read on X**: paragraphs, ## subheadings, bold and italic, blockquotes, lists, links and inline images, all of which render here as they will there. Notes, beats, outlines, scores and commentary are not part of it; they live in a separate plain document (content_type "document"). There is no 280-character limit.

**The cover** is articleContext.coverImage, with any alternatives in articleContext.coverImages. insert_image({ prompt, set_cover: true, aspect_ratio }) generates one and makes it the cover of the document open in the editor (set_cover does not take a docId). Inline images go in with insert_image({ docId, afterNodeId, prompt }), or ![alt text](/_images/name.png) for a picture already in the profile's _images folder.

**One document is one draft.** Another version is a new article document, so the earlier draft stays to compare.
