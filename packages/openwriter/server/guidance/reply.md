---
version: 1
---
## X reply

This document is a reply to an X post: content_type "reply", metadata tweetContext { mode: "reply", url }. tweetContext.url is the post being replied to. create_document refuses a reply without url.

The compose view draws the parent post above the reply from that URL. The parent's text is not stored in this document. It can be read free as JSON at https://api.fxtwitter.com/<user>/status/<id>, the same path as the x.com URL on a different host, with its author, text, media, metrics and any post it quotes. A reply written without reading the parent answers a post it has not seen.

The URL lives only in metadata; the body never repeats it. A reply can be a thread: rules divide it into posts the same way (see the thread contract).
