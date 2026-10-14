# Architecture: container layout, doc lifecycle, output contract

Reference for how one post's OpenWriter docs are structured, built, and returned. Consulted during a build — the per-mode docs (`beats.md`, `draft.md`, `images.md`, `integrate.md`) own the per-step detail; this is the consolidated overview.

## Per-post container layout

Each post lives in its own container under the blog workspace:

```
[Project] Blog/                            (workspace)
└── <Post Title>/                          (per-post container)
    ├── Beats — <Post Title>               (beats mode output — content_type: document)
    ├── <Post Title>                       (draft mode output — content_type: blog, THIS is the publishable doc)
    └── Sources — <Post Title>             (optional — content_type: document)
```

The Draft doc's title IS the post's locked title (no prefix). The Draft doc is identified inside the container by `content_type: blog` — only one per container.

Beats and Draft are SEPARATE docs by firm rule. Beats reshape → draft re-pour stays cheap because each doc has a single owner. Sources is optional — most posts let the model's training data carry examples; build a Sources doc only for post-training-cutoff topics or contested citations the author wants pinned.

## OpenWriter doc lifecycle (call order for one post)

How a single post's docs are prepared, populated, mirrored, and published — in call order. Each mode owns part of this sequence:

| Step | When | Tool call | Notes |
|---|---|---|---|
| 1 | First post for a project | `create_workspace({ name: "[Project] Blog" })` | Only if the project's blog workspace doesn't exist yet. Check `list_workspaces` first. |
| 2 | `beats` mode, start of session | `create_container({ workspace_id, name: "<provisional post title>" })` | Per-post container; rename later if title sharpens. Provisional name from brainstorm / source material. |
| 3 | `beats` mode | `create_document({ workspaceFile, containerId, title: "Beats — <Post Title>", content_type: "document" })` → `populate_document` | Two-step. The Beats doc is the methodology output; lives the whole post's life. |
| 4 | `beats` mode, on title-lock | `rename_item({ id: container_id, name: "<locked title>" })` + same for Beats doc title if provisional | Container name + Beats doc title both follow the locked title; keeps the sidebar coherent. |
| 5 | `draft` mode, first run | `create_document({ workspaceFile, containerId, title: "<locked title>", content_type: "blog" })` | The Draft doc title IS the published title (no prefix). content_type `blog` marks it as the publishable doc inside the container; the document's format contract arrives with it. |
| 6 | `draft` mode, immediately after Step 5 | Mirror B0's description, slug, date and tags onto the Draft doc | Where each lives: the blog contract. |
| 7 | `draft` mode, per beat | `/authors-voice` Apply Protocol → integrate result into Draft doc (target by `docId`, not by active view) as a pending decoration | Per-beat dispatch is the default; collapse to single dispatch for `short`/`announcement` under 1000w. |
| 8 | `images` mode | Cover and inline images | See [images.md](images.md). |
| 9 | Before `integrate` | `get_pad_status({ docId: draftDocId })` → expect `pending: 0` | If pending > 0, prompt user to Accept All in the right-rail Review tab. |
| 10 | `integrate` mode | `post_to_blog` | See [integrate.md](integrate.md). |

Reshape loop: Steps 2–7 repeat for affected beats only — never re-pour the whole post.

## Output contract

Every mode writes to OpenWriter and returns (shape per [WRITER-CONVENTION.md](../../WRITER-CONVENTION.md)):

```json
{
  "status": "draft-ready" | "needs-input" | "blocked",
  "artifact": { "doc_id": "...", "workspace_id": "...", "container_id": "..." },
  "next_steps": ["/blog-writer beats", "/blog-writer draft", "/blog-writer images", "/blog-writer integrate"],
  "notes": "<optional>"
}
```

Mode chain (`next_steps`):

- After `setup` → `["/blog-writer brainstorm", "/blog-writer beats"]`
- After `brainstorm` → `["/blog-writer beats"]`
- After `beats` → `["/blog-writer draft"]`
- After `draft` → `["/blog-writer images", "/blog-writer integrate"]`
- After `images` → `["/blog-writer integrate"]`
- After `integrate` → `["verify-live-url"]` (most sites auto-deploy on push; a manual deploy step only for projects with custom deploy pipelines)
