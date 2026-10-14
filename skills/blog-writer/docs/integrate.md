# Mode: Integrate

Publish the approved blog doc to a registered blog repo with one `post_to_blog` call. What the call reads from the document, what it needs and what it records afterwards is in the blog contract OpenWriter sends with the document.

## Source of truth (read first)

The OpenWriter doc is the **single source of truth** and `post_to_blog` is the **only writer** to the blog repo. The flow is always **doc → Accept pending → Publish**. Never hand-edit the published `.md`, never hand-set its `image:` frontmatter, never drop a cover into the repo's `public/`, and never `git push` the post yourself — each creates a doc-vs-repo drift that the next Publish silently overwrites, so your hand-edits vanish and the cover can orphan. Before trusting a republish, verify the emitted `image:` matches the site's other posts.

## When to use

- User says "integrate" / "publish" / "post to blog" / "wire up the post" / "ship the post"
- Pipeline mode is on Step 5
- Draft is approved in OpenWriter and any cover/inline images are accepted

## Workflow

### Step 1: Find the site

`list_blog_sites`. If multiple sites and the user didn't name one, ask. If zero, redirect to `/blog-writer setup`.

### Step 2: Check the post is complete

Locked title, description, slug, date, tags and cover with alt text (SKILL.md Firm rules).

### Step 3: The writer accepts every pending change

Tell the user: *"Click Accept All (or Shift+A) in the right-rail Review tab, then I'll publish."* Wait for them, then confirm `get_pad_status({ docId })` shows no pending changes. That includes a title you renamed: until it is accepted, the old title publishes. Accepting is the writer's review step: never accept on their behalf.

### Step 4: Publish

`post_to_blog({ site_id, commit_message })` with the post open in the editor. Default commit message: `blog: {title}`.

### Step 5: Verify

If `images_committed` is less than expected, pending images were not accepted: back to Step 3. A `validation_warning` or a `Publish blocked` result names the frontmatter the site rejects.

### Step 6: Wait for auto-deploy

Most static sites deploy on push (Netlify, Cloudflare Pages, Vercel) — usually 1–3 min for an Astro/Next build. If the site has a custom deploy pipeline, hand off to your project's deploy pipeline instead.

Verify the URL returns HTTP 200:
```bash
curl -sS -o /dev/null -w "HTTP %{http_code}" -L --max-time 15 "<live_url>"
```

For the live render check (does the post look right? did the cover land? does the layout pick up the new tags?), open the URL in the user's chrome via the Claude_in_Chrome MCP.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "doc_id": "<openwriter doc>",
    "workspace_id": "...",
    "site_id": "<site uuid>",
    "commit": "<short hash>",
    "file": "<repo path>",
    "live_url": "<projected URL — verify after deploy>"
  },
  "next_steps": ["announce (your own channels)"],
  "notes": "Published to <owner>/<repo>@<commit>. Site auto-deploys on push; verify live URL in ~2 min."
}
```

## Anti-patterns

- ❌ Manually writing the post .md file into the target repo via Write/Edit tools — skips frontmatter assembly, image copy, path rewrite, and the per-site config
- ❌ Publishing before the writer accepts — agent writes and images don't ship
- ❌ Manually `git push`-ing from the local clone after `post_to_blog` already pushed — the plugin owns the commit + push, double-pushing creates noisy history
- ❌ Auto-committing the new files in the target repo — the plugin already committed them; touch them only if a follow-up edit is genuinely needed
