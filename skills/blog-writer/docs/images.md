# Mode: Images

Generate the featured (cover) image and any inline body images for a blog post. Primary path is the openwriter `insert_image` MCP tool, so the image lives in OpenWriter and `post_to_blog` carries it to the repo. How the cover and inline images attach to a blog document is in the blog contract OpenWriter sends with it.

## When to use

- User says "blog image" / "featured image" / "OG image" / "cover image" / "inline image for the post"
- Pipeline mode is on Step 2
- User has an approved draft and needs the visual

## Requirements

- `GEMINI_API_KEY` set on the openwriter server (the plugin falls back to the publish platform API if absent)
- Project SHOULD have a `style_doc` in `## Blog` config — used to pick a consistent visual style across the site. Optional but recommended.

Two roles: the **cover** (OG card / hero, published in the post's frontmatter) and **inline** images (body images at a specific point).

## Workflow

### Step 1: Read style guidance

If the project's `## Blog` config has `style_doc`, read it. Style docs typically have:
- Visual categories + decision tree
- Tone matrix (matching the post's angle to a style)
- Prompt templates per style
- Project-specific rules (safe zones, no-faces, etc.)
- History table of previously used images (skip styles used in the last 3 posts)

If no `style_doc`, default to: "clean modern illustration; soft palette appropriate to the site's brand; 16:9 cover, 16:9 inline; no text on image."

**OG placement rules — any cover that carries text obeys these placement rules:** no text at the bottom (the platform renders og:title there → collision), ≤5–7 words, don't echo the title/description, keep the subject in the center safe zone, must read in 1–2s at thumbnail. **Text-overlay covers** (photo+text styles) are composited with Sharp: generate the *no-text* base via `insert_image`, then overlay text from a `C:/tmp/` working file (left/center-left, never bottom) and move to the project only on approval. Pure no-text covers (Style A/B/C) skip tmp and ride the `insert_image` path below.

**Canonical output size: 1200×630 (1.905:1).** The blog card hard-codes this ratio (`aspect-ratio: 1200/630`); the post page shows the image uncropped. Gemini's widest is 16:9, so generate at `aspect_ratio: "16:9"` then Sharp `fit:"cover"` to exactly 1200×630 (trims top+bottom of the AI frame — keep the subject centered). Honor a `feature_image_size` override from the project's `## Blog` config. **Do not trust OpenWriter's article-cover preview for spacing** — it clips to ~2.5:1; the real blog post page renders the full 1200×630.

### Step 2: Analyze content (optional)

If `content_driven: true` in the project's `## Blog` config, read the post via `read_pad` first. Extract the ONE concept that would make someone scroll-stop and click. The cover prompt should land that concept visually.

### Step 3: Craft the prompt

Universal rules (apply to every prompt regardless of project):
- 2–4 sentences, focused
- Specific scene description over abstract concepts
- Include lighting details — they drive mood more than anything else
- End with "No text, no watermarks, no logos"
- Never say "leave [area] empty" — Gemini interprets that as "draw a literal box"
- Money in word form: "Five Hundred Dollars" not "$500"

### Step 4: Generate the cover

Generate at `aspect_ratio: "16:9"` and make it the post's cover with alt text that says what's in the image and why it's relevant.

### Step 5: Generate inline images (optional)

Each inline image goes after the paragraph it illustrates, with descriptive alt text. Inline images land as pending changes: **tell the user to accept them in the Review tab before invoking integrate.**

### Step 6: Review

Show the user the generated images in the openwriter UI (or via Claude_in_Chrome screenshot). Iterate prompts until approval. Generated images often miss the mark on the first try; budget for 2–3 regenerations.

### Step 7: Update style history (optional)

If using a `style_doc` with a history table, add an entry: post title, style used, date. Keeps the next post from repeating.

## Image format notes

The github plugin copies PNGs into the repo unchanged. If the target site insists on `.webp` for performance, run sharp conversion before publish — or set up the site's build pipeline to handle PNG → WebP at build time (preferred). The plugin doesn't convert formats.

```bash
# If you must pre-convert
node -e "require('sharp')('<src.png>').webp({quality:82}).toFile('<dst.webp>').then(()=>{})"
```

## Standalone CLI fallback

For non-OpenWriter workflows (legacy projects, scripted batch image generation, projects that don't use the github plugin):

```bash
node <path-to-image-gen-cli>/cli.bundle.js \
  -p "[PROMPT]" \
  -o /c/tmp/blog-image.png \
  -a "16:9"
```

This was the v0.3.x path. The image lands in `/c/tmp/`, then a manual file copy + frontmatter edit wires it into the project. The new path via `insert_image` skips all that — image lands in OpenWriter and rides through `post_to_blog` to the repo.

## Style libraries

Each project can have its own style doc (anywhere on disk — point to it via `style_doc` in the project's `## Blog` config) with:
- Visual categories and decision tree
- Tone matrix
- Prompt templates per style
- Project-specific rules
- History table

### Example

| Project | Style doc |
|---|---|
| RecipeBox | `<your style library dir>/recipebox.md` |

To add a new project's style doc: create the file with the same structure and reference it in the project's `## Blog` config under `style_doc`.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "doc_id": "<blog draft doc>",
    "workspace_id": "...",
    "cover_image_path": "/_images/<filename>.png",
    "inline_image_paths": ["/_images/<filename>.png", "..."]
  },
  "next_steps": ["/blog-writer integrate"],
  "notes": "Cover set. Inline images placed as pending changes — tell the user to Accept All in the right rail before publishing."
}
```

## Anti-patterns

- ❌ Saving the image to `/c/tmp/` and manually copying it into the target repo — that's the old v0.3 path; the new flow puts images directly in OpenWriter and lets `post_to_blog` handle copy + path rewrite
- ❌ Forgetting the cover's alt text — accessibility + the site layout often shows alt text as a caption fallback
- ❌ Generating an image before content is approved — angle might shift
- ❌ Reusing a style from the last 3 posts — history table exists for a reason
