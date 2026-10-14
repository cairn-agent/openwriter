---
version: 1
---
## Newsletter issue

This document is a newsletter issue: content_type "newsletter", metadata newsletterContext. The editor shows a Subject field, a Preview text field, then the body.

**An issue is sent by publishing it as a post on the writer's OpenWriter site with email**: publish_to_site({ send_email: true }), a publish-plugin tool. It publishes the document open in the editor (it takes no docId) and sends it to the site's subscribers. A post is emailed once: publishing the document again updates the web post and never sends a second email. publish_to_site({ draft: true }) saves it unpublished, after which send_test_email sends it to the writer alone and preview_site_post shows the web or email version. list_newsletter_issues lists the issues sent.

**Subject and preview line.** The email's subject is the post title: publish_to_site's title argument, else the document's accepted title. The line inboxes show after the subject is the post's subtitle. The editor's Subject and Preview text fields are stored as newsletterContext.subject and newsletterContext.previewText, and publish_to_site reads neither, so they reach the email only as its title and subtitle arguments. A rename_item from an agent stays pending until the writer accepts it, and until then publishing uses the old title. A new issue without a title is called "Newsletter", which is never replaced automatically.

**The email draws the title and subtitle above the body**, so the body does not repeat them; a first line equal to the title is dropped. Headings, paragraphs, lists, blockquotes, horizontal rules, images, tables, links, bold and italic all reach the email; a line break inside a paragraph stays a line break. Pictures under /_images/ are uploaded with the post.

**The cover** is publish_to_site's cover_url, an http(s) URL or a /_images/ path. Without one it uses the document's articleContext.coverImage: insert_image({ prompt, set_cover: true, aspect_ratio }) generates one and sets it on the document open in the editor (set_cover does not take a docId), and set_metadata({ docId, metadata: { articleContext: { coverImage: "/_images/<name>.png" } } }) sets a picture already in the images folder. The issue stays a newsletter either way.

**Scheduling** is publish_to_site({ publish_at: "<future ISO date-time>", send_email: true }). The editor's Schedule button and schedule_post queue social posts, not the email.

**Paywall and blocks.** Below a <!-- paywall --> line the issue is for the audience publish_to_site names (subscribers, paid or founding); free readers get the part above it. publish_to_site's description lists the other block markers ([paid-only], [free-only], [callout], [subscribe], [poll]).

**After sending**, the document's metadata.sitePost holds the post's id, slug, status and url. newsletterContext.lastSend is from an older send path and is no longer written.

**One document is one issue.** The next issue is a new newsletter document.
