---
version: 1
---
## X quote post

This document is a quote post: content_type "quote", metadata tweetContext { mode: "quote", url }. tweetContext.url is the quoted post. create_document refuses a quote without url.

The compose view draws the writer's text above and the quoted post as a card below, from that URL. The quoted post's text is not stored in this document. It can be read free as JSON at https://api.fxtwitter.com/<user>/status/<id>, the same path as the x.com URL on a different host, with its author, text, media, metrics and any post it quotes in turn. A quote written without reading the quoted post comments on a post it has not seen.

The URL lives only in metadata; the body never repeats it, because X attaches the quoted post itself.
