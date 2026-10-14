---
name: blog-writer
description: |
  Channel-master writer for long-form blog posts. Owns the SHAPE of a post —
  beat structure, title/preview/slug commitments, per-post container layout,
  per-site voice anchor discovery — and delegates VOICE (prose generation) to
  /authors-voice and PUBLISH mechanics to the openwriter github plugin
  (`add_blog_site` + `post_to_blog`).

  Use when: "/blog-writer", "write a blog post", "blog draft", "brainstorm blog
  topics", "blog beats", "extract beats from this post", "write about this
  feature", "draft a post", "blog title", "preview text", "OG description",
  "blog image", "featured image", "OG image", "integrate", "create the files",
  "wire up the blog post", "publish to blog", "post to blog", "set up blog repo",
  "register blog site".

  Requires: OpenWriter MCP server configured + github plugin enabled +
  `gh auth login` set up locally. Project SHOULD have a `## Blog` section in its
  CLAUDE.md for writing-rules / image-style overrides (optional after setup).
metadata:
  author: travsteward
  version: "0.5.0"
license: MIT
---

# Blog Writer

Channel-master skill for long-form blog content. Owns ideation → beats → draft → image → publish.

**Architecture:** beats-first (v0.5.0) + plugin-backed publish (v0.4.0). Each post lives in its own container with two sibling docs: a `Beats` doc (the structural commitments — beat list + title/preview/slug as B0) and a `Draft` doc (the voice-poured prose). Beats reshape regularly; draft re-pours via `/authors-voice` against a per-site anchor (`voice/anchor-<site-slug>.md`). Publish is a single `post_to_blog` MCP call against a site registered via `add_blog_site`. Mirrors book-writer's discipline at post scale.

**Format rules for blog documents (title, blogContext fields, slug, cover, body, what `post_to_blog` needs) arrive from OpenWriter when the document is opened.** This skill keeps voice, beats, titling, SEO and editorial judgment, and the pipeline.

## Convention

This skill obeys the shared writer contract at [WRITER-CONVENTION.md](../WRITER-CONVENTION.md). Brief shape and return shape match that doc. Sub-form values: `long` | `short` | `tutorial` | `announcement`.

**OpenWriter pad mechanics are canonical in [/openwriter](../openwriter/SKILL.md) — read it, don't re-derive from tool descriptions.** The load-bearing rule: `populate_document` is **create-only, used ONCE**; it re-sends the whole body, so calling it again to "fix" a doc appends a duplicate. All edits (rewrite / insert / delete) go through `write_to_pad` on fresh node IDs. Plus the read ladder (`outline_doc` → `search_docs` → `peek_doc` → `read_pad`).

**Blog posts ship SEO-complete in the FIRST pass.** A blog post almost always carries SEO — internal/cluster links, meta + slug + tags, snippet-targeted headings, FAQ/schema-eligible content all go into the *initial* draft (the minion brief + first `populate_document`), never bolted on after. Bolting SEO on later forces an edit (→ `write_to_pad`, never a 2nd populate). SEO-strategy-led posts (pillar / landing / comparison) front-end through `/seo-writer` if you have it installed (not bundled with OpenWriter).

**Cover image is a publish gate** (Firm rules). Placement rules: no bottom-band text (the platform renders og:title there), keep the subject center-safe, ≤5–7 words of overlay text, do not echo the title/description. Palette / brand skin comes from the project's `style_doc` (e.g. `recipebox.md`). Generation, canonical size, and the tmp-first rule for text-overlay covers: [docs/images.md](docs/images.md).

**ABOUT TO HAND-EDIT A PUBLISHED POST'S `.md`, ITS `image:` FRONTMATTER, OR DROP A COVER INTO THE REPO'S `public/`? STOP.** The OpenWriter doc is the single source of truth, and `post_to_blog` is the ONLY writer to the blog repo. Edits flow **doc → Accept → Publish** — never doc *and* repo in parallel, because Publish rewrites the post file wholesale and your hand-edits vanish. Never hand-name a cover; never side-channel an image; never `git push` the post yourself. Publish flow: [docs/integrate.md](docs/integrate.md).

## Modes

| Mode | Trigger | What it does | Sub-doc |
|---|---|---|---|
| `setup` | `/blog-writer setup`, "register blog repo", "add blog site" | One-time per blog: `inspect_blog_repo` clones the target, auto-proposes `frontmatter_defaults` + `frontmatter_field_map` from existing posts; `add_blog_site` persists the site config | [docs/setup.md](docs/setup.md) |
| `brainstorm` | `/blog-writer brainstorm`, "brainstorm blog topics" | Open a Blog Ideas doc; propose 3-5 candidate angles with tone + length labels; hand off to `beats` when user picks | [docs/brainstorm.md](docs/brainstorm.md) |
| `beats` | `/blog-writer beats`, "extract beats", "blog beats" | Query-first beat extraction with 3-pass (short/announcement, 3-5 beats) or 5-pass (long/tutorial, 8-15 beats); 9 blog category tags (CLAIM/REFRAME/MECHANISM/EVIDENCE/DEMO/SCENE/OBJECTION/APHORISM/PIVOT) + HOOK/CTA positional roles; locks title + preview + slug as B0; dopamine arc layered with conversion arc | [docs/beats.md](docs/beats.md) + [docs/titling.md](docs/titling.md) |
| `draft` | `/blog-writer draft`, "draft this post", "pour the beats" | Per-beat dispatch to `/authors-voice` Apply Protocol with site-specific anchor; cross-beat coherence pass; supports beat-level reshape loop (re-pour only the affected beats) | [docs/draft.md](docs/draft.md) + [docs/voice-anchor.md](docs/voice-anchor.md) |
| `images` | `/blog-writer images`, "blog image", "featured image" | Read style doc, craft prompt, generate the cover; optional inline images | [docs/images.md](docs/images.md) |
| `integrate` | `/blog-writer integrate`, "publish", "post to blog" | `post_to_blog` against the registered site once the writer has accepted every pending change; verify the live URL | [docs/integrate.md](docs/integrate.md) |
| `pipeline` | `/blog-writer pipeline`, "full blog workflow", "write and publish" | 7-step sequence (Setup → Brainstorm → Beats → Draft → Images → Accept → Publish → Verify) with explicit gates; reshape loop returns to Beats step | [docs/pipeline.md](docs/pipeline.md) |

Modes can chain (pipeline runs them in sequence) or stand alone. Beats reshape → draft re-pour is the inner loop the architecture is designed around.

## Setup (per-session vs per-blog)

**Per-session.** Read the project's CLAUDE.md and extract the optional `## Blog` section. It can carry `writing_rules`, `style_doc`, `content_driven`, `aspect_ratio`. Used by `images` mode + as defaults for `beats`/`draft`. Schema: [docs/project-config.md](docs/project-config.md). If absent, defaults apply and the skill still runs.

**Per-blog (one-time).** Each blog repo must be registered with the github plugin via `add_blog_site` before `integrate` can publish to it. Run `/blog-writer setup` once per blog. The setup mode uses `inspect_blog_repo` to auto-propose `frontmatter_defaults` (layout, author, prerender — fields constant across the site's existing posts) and `frontmatter_field_map` (e.g. `date → publishedDate` for Astro sites). Sub-doc: [docs/setup.md](docs/setup.md).

## Architecture (build internals)

Per-post container structure (Beats + Draft sibling docs), the 10-step OpenWriter call-order for building one post, and the return/output contract live in [docs/architecture.md](docs/architecture.md). Two facts ride every build:

- **Two sibling docs per post.** `Beats — <Title>` (content_type `document`) holds structure; `<Title>` (content_type `blog`) is the publishable Draft — one per container. Reshape beats → re-pour only the affected beats, never the whole post.
- **ABOUT TO CALL `switch_document` (or any view-control MCP) MID-BUILD? STOP.** The agent builds the container + Beats + Draft + metadata + images silently, targeting docs by `docId`; the user watches the activity feed and navigates themselves. Only `switch_document` on an explicit user instruction ("open the Draft", "show me the Beats") or when publishing needs the post open.

## Firm rules

1. **Beats before draft.** Draft mode requires a locked Beats doc. No beats → run `beats` first. Pouring prose without committed beats produces shapeless drafts that need full structural rework downstream.
2. **Beats and Draft live in separate docs, always.** One container per post, two sibling docs: `Beats — <Post Title>` (content_type: document) and `<Post Title>` (content_type: blog — the publishable doc). Beats reshape → draft re-pour. Don't mix prose into the Beats doc; don't put structural commitments in the Draft doc.
3. **Title + preview + slug are B0 commitments.** Locked in the Beats doc's B0 block during `beats` mode. When `draft` mode runs they mirror onto the Draft doc. See [docs/titling.md](docs/titling.md). The first paragraph of the draft must echo the title — can't echo what isn't locked.
4. **Per-site voice anchor.** `draft` mode reads `voice/anchor-<site-slug>.md` where `<site-slug>` is the slugified site label from `list_blog_sites`. Silent fallback to `voice/anchor.md` if not present. Discovery is convention-based, NOT in plugin config. See [docs/voice-anchor.md](docs/voice-anchor.md).
5. **Setup before integrate.** A blog repo must be registered via `add_blog_site` before `integrate` can publish. Check `list_blog_sites` at session start — if the target repo isn't there, run `/blog-writer setup` first.
6. **Project config is optional; per-site config is canonical.** `## Blog` in CLAUDE.md is for `writing_rules`, `style_doc`, `content_driven`, `aspect_ratio`. Frontmatter shape lives on the site registered with the github plugin, NOT in project config.
7. **Voice always.** Every beat pours through `/authors-voice` Apply Protocol with the site-specific anchor. The skill owns shape; voice owns diction. Per-beat dispatch is the default for `long`/`tutorial`; collapse to single dispatch for `short`/`announcement` under 1000w.
8. **Two-step doc creation.** `create_document` (spinner) → `populate_document` (content). Never inline a 30s generation into one tool call.
9. **Today's date in the doc**, in the project's configured timezone (default `America/Los_Angeles`).
10. **The writer accepts before you publish.** After agent writes, `integrate` tells the user "click Accept All in the right rail, then I'll publish" rather than silently posting incomplete content.
11. **Cover image before publish.** No post `integrate`s without a cover/OG image — a gate, not optional. Design per the Convention above (placement rules + `style_doc` palette; [docs/images.md](docs/images.md) mechanics).

## Anti-patterns

- ❌ Calling `draft` without first running `beats` for the post — fails with "no Beats doc found in container"
- ❌ Writing the blog post `.md` file directly into the target repo via Write/Edit tools — that's `post_to_blog`'s job
- ❌ Generating an image before the content is approved (image themes might shift)
- ❌ Skipping voice protocol because "the draft sounds fine"
- ❌ Mixing modes — finish one, then start the next
- ❌ Single global voice anchor when a site-specific one exists — `draft` mode reads conventionally; no opt-in required
- ❌ Reshaping beats AND re-pouring the entire draft in one pass — reshape beats first, lock them, then re-pour ONLY the affected beats
- ❌ Calling `/blog-pipeline`, `/blog-images`, `/blog-integrate`, `/blog-feature-images` as separate skills (deprecated stubs that redirect here)

## Scripts

- `mcp__openwriter__insert_image` — Gemini image generation in OpenWriter (primary path)
- image-gen CLI (if installed locally) — standalone fallback for non-OpenWriter workflows
- Sharp conversion (PNG → WebP) — for projects where the target site insists on `.webp` (the github plugin copies PNGs unchanged; conversion is a project-specific concern before publish)

## Related skills

Delegated / required:
- **/authors-voice** — voice pipeline; REQUIRED for any prose generation (`draft` delegates every beat dispatch).
- **/anti-ai** — final AI-tells fingerprint scrub; recommended after a post is voice-poured.
- **openwriter** — the workspace/document MCP; REQUIRED for the doc management this skill governs.
- **/seo-writer** — optional, not bundled: SEO-strategy-led posts front-end there, then reuse this skill's publish path.

NOT covered (use your own tooling instead): project deploy pipelines · cross-channel announcements (Discord, X, etc.) · **/newsletter-writer** (different channel) · **/x-writer** (different channel) · **/book-writer** (multi-chapter books — global beat sheet, workspace management).
