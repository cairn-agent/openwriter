---
version: 1
---
## X post (tweet)

This document is an X post: content_type "tweet", metadata tweetContext { mode: "tweet" }. The editor shows it in X's compose view. It holds one post, or a thread when horizontal rules divide it (see the thread contract).

A new one is made with create_document({ title, content_type: "tweet", empty: true }) and written with write_to_pad or populate_document by docId. The compose view needs no other setup. set_metadata({ tweetContext: null }) turns it back into a plain document.
