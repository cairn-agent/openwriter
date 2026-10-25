# ADR: Three type styles, shared with the published site and its emails

Referenced by `packages/openwriter/src/themes/vendored-fonts.css`, `themes/type-styles.css` and
`themes/site-type-style.ts` (`adr:` markers). The site's and emails' copy lives in the gateway
repository (`repo:openwriter-publish/adr/type-styles.md`).

## Context

By 2026-10-25 the editor offered nine typefaces and four spacing presets, none of which a published
site or email used, while the site paired its own faces from a list of eight. What a writer saw while
writing was not what readers got. The editor now uses the site's three styles, at the site's sizes.

## Current invariants

- The editor's type is one of `classic` (Source Serif 4 throughout), `editorial` (Playfair Display
  titles, Newsreader text) or `modern` (Inter throughout), set by `data-type-style` on `<html>`.
  The faces, the reading scale (1, 1.115, 0.87), sizes and dark-mode weight (370) match the gateway's
  `src/modules/sites/web/fonts.ts` and `style.ts`. A change to a style changes both repositories in
  the same piece of work.
- Font files carry optical size where the face has it, come in a Latin and a Latin Extended file
  (`unicode-range`), and have a metric-matched local stand-in so loading never moves text.
- When the writer has a site, the editor takes the site's style on start and when the Aa menu opens,
  and picking a style in the menu sets the site's (owners and admins; a contributor's menu is
  locked). Without a site the style is local to this editor (`ow-type-style`).
- There are no spacing presets. The old `ow-typeface` value migrates once: sans faces (inter,
  grotesk, dm-sans) to modern, the rest to classic.

## Decision log

### 2026-10-25 — Three styles replace nine typefaces and four spacings

Chosen over keeping a separate editor-only choice: the writer judges a post by how it will read, so
the editor shows the published type. Spacing presets dropped because the site has one measure.
