# Image Workflow

## Thread → Image Set Pipeline

### Phase 1: Character Setup (optional)

Before generating images, establish recurring characters if applicable.

**Create a new character:**
1. Describe the character in detail (appearance, clothing, build, hair, distinguishing features)
2. Generate a clear reference image — front-facing, evenly lit, 1:1 aspect ratio
3. Save to `~/.claude/skills/x-writer/scripts/characters/{name}.png`

```bash
node ~/.claude/skills/x-writer/scripts/generate-image.js \
  -p "Character portrait: [DETAILED DESCRIPTION]. Front-facing, evenly lit, neutral background, clear facial features. No text, no watermarks, no logos." \
  -o ~/.claude/skills/x-writer/scripts/characters/{name}.png \
  -a "1:1"
```

**Import an existing image as character:**
- Copy any PNG/JPG to `~/.claude/skills/x-writer/scripts/characters/{name}.png`
- Best results: clear face, good lighting, 1024x1024+

### Phase 2: Thread Analysis

Read the thread draft and map each tweet to an image:

1. **Read the thread** — from OpenWriter or user input
2. **Identify image tweets** — each tweet that benefits from a visual
3. **Extract scene descriptions** — what's happening in each tweet?
4. **Identify characters** — which characters appear in each image?
5. **Plan visual progression** — images should tell a visual story, not just illustrate individual tweets

### Phase 3: Image Generation

For each image, generate with character references when needed:

```bash
# Single character
node ~/.claude/skills/x-writer/scripts/generate-image.js \
  -p "[ROLE DESCRIPTION]. [SCENE PROMPT]. [STYLE SUFFIX]. No text, no watermarks, no logos." \
  -o /c/tmp/panel-{N}.png \
  -r ~/.claude/skills/x-writer/scripts/characters/{name}.png \
  -a "16:9"

# Multiple characters
node ~/.claude/skills/x-writer/scripts/generate-image.js \
  -p "Image 1 is Character A (face reference). Image 2 is Character B (face reference). [SCENE]. No text, no watermarks, no logos." \
  -o /c/tmp/panel-{N}.png \
  -r ~/.claude/skills/x-writer/scripts/characters/char-a.png \
  -r ~/.claude/skills/x-writer/scripts/characters/char-b.png \
  -a "16:9"
```

### Phase 4: Review & Iteration

- Show each image to the user
- Regenerate any that don't maintain consistency
- For stubborn inconsistencies: use multiple angle references (front, 3/4 left, 3/4 right)

### Phase 5: Insert into Thread

Two ways to attach images to posts. Where an image goes and how it is inserted is in the document's format contract, which OpenWriter sends with the document.

**Option A: `insert_image`** generates via Gemini and inserts in one step, all posts in parallel. It takes no reference images, so character consistency relies on the prompt alone. Best for quick sets with no character reference.

**Option B: CLI generate, then insert the files.** Generate with `-r` reference images (Phase 3), then insert the files. Best for maximum character consistency.

**Trade-off:** Option A is faster and seamless but has no reference image support. Option B gives better character consistency but requires manual file handling.

## Prompt Construction

### Role Description (for reference images)
When passing reference images, ALWAYS describe their role:
- "This is the face reference for Character A. Maintain their exact appearance."
- "Image 1: Character A face reference. Image 2: Character B face reference."

### Scene Prompt
Describe the specific scene for this image:
- What are the characters doing?
- Where are they?
- What's the emotional tone?
- What angle/framing?

### Style Suffix
Append a consistent style suffix across ALL images in a set to maintain visual coherence:
- Pick ONE style from `images/styles.md` and use it for the entire set
- Never mix styles within a single set

## Aspect Ratios

| Use Case | Ratio | Notes |
|----------|-------|-------|
| Thread images | 16:9 | Standard X image display |
| Article cover | 16:9 | X Articles ~1600x900 |
| Character sheets | 1:1 | Best for reference images |
| Vertical | 9:16 | Mobile-optimized |
| Square | 1:1 | Equal weight |
