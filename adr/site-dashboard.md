# The site dashboard: every site control as a screen, through the agent's tools

Referenced by `plugins/publish/client/` (`adr:` markers) and `plugins/publish/src/index.ts`.

## Context

A writer without an Anthropic key has no chat agent, and before this every site control (posts,
subscribers, stats, comments, plans, settings) was reachable only through the agent's tools. The
Substack parity plan (`openwriter-publish/docs/web-app/parity-build.md`) puts a "Your site"
button in the title bar that opens a full-page dashboard over the editor at `/site/<page>`, with
Substack's pages and words: Home, Posts, Subscribers, Stats, Comments, Growth, Money, Settings.
It was built in the private web app (`client/site/`) and since 2026-10-25 lives in the publish
plugin (`plugins/publish/client/`), so the desktop app and the web app run the same screens.

## Current invariants

- **One way in for each job.** Every read and every action on the dashboard is a publish plugin
  tool run through `/api/mcp-call` (`api.ts` `run` / `useTool`), the same tools the chat agent
  calls. The dashboard never calls the publish server itself, so the screens and the agent cannot
  disagree, and a fix to a tool fixes both.
- **The chosen site rides on every call** as the tools' `site` argument (`setSiteKey`); with one
  site the dashboard passes none and the tools act on the profile's own site. The choice is
  remembered per OpenWriter profile (`followProfile` reads the active one before the site loads):
  list_my_sites lists every site of the account, so a choice made under one profile never carries
  over to another.
- **One copy for both apps.** The screens are the publish plugin's `clientModule`, built by vite to
  `dist/client/site.js` with its own React, and mount their own root. The web app adds only what is
  web-only (the phone layout, which opens the dashboard with the `openwriter:open-site` window
  event and reuses the plugin's pure modules from source).
- **The URL is the page.** `/site/<page>` is pushed on open and on each page change; Back to
  writing (or the browser's Back past the first dashboard page) returns to the address the editor
  had. A reload on `/site/...` opens the dashboard again, because the app server answers every path
  with the client.
- **Plain words on screen**: no ids, every button that reaches readers names the outcome and the
  count, irreversible actions confirm once naming the object, and every wait says what it is doing.

## Decision log

- **2026-10-12 — Created.** The dashboard mounts its own React root beside the app's (like the
  phone layout) and covers the editor while open; the editor stays mounted underneath so Back to
  writing is instant and unsent edits are never at risk.

- **2026-10-12 — The address survives a reload.** OpenWriter replaces the address with its
  document's (/d/...) when the first document arrives, which dropped /site/<page> after a reload
  on it while the dashboard stayed open. `nav.ts` `reclaimAddress` runs once on that first
  document: the app's address becomes Back to writing's target and /site/<page> is put back. The
  dashboard never patches history methods. Client modules can load after that first document, so
  `startNav` also opens from the address the page was loaded at (the navigation timing entry).

- **2026-10-12 — Bylines and post extras.** Publish gains "Written by" (you, team members, guest
  authors); it sends authors only once the writer changes them, so republishing never resets a
  post's bylines. Posts gains Cross-posts (managers only) and a Poll results action on posts whose
  stats count poll votes. Settings gains terms and privacy pages, the reader switches (likes,
  bylines, comment pictures, cross-posting), the site language and guest authors on Team.

- **2026-10-12 — Surveys page.** Surveys gets its own page in the menu (/site/surveys, and
  /site/surveys/<id> for one survey's results and responses) rather than a tab, so a survey has
  an address to come back to. Once a survey has answers the editor locks adding, removing, moving
  and retyping questions, matching the server, which stores answers by position. Insert block
  gains Survey, which lists the open surveys and writes the [survey] line.

- **2026-10-13 — Which site the dashboard acts on.** Found in a live run: after a reload the
  dashboard fell back to the writer's own site, so Publish on a document already posted on another
  site could make a second post on the own site (with email on by default). Now the chosen site is
  remembered in the browser (dropped if the writer is no longer on it), Publish switches to the
  site the open document is already a post on, and the publish tool refuses to re-make a post on a
  different site. The header names the site once (the picker when there is a choice). The hosted
  app hides the profile switcher, since it keeps one profile per writer.

- **2026-10-13 — Emails off.** Publish's "email N subscribers" counts only people who get emails
  (emailed_by_tier); subscribers who turned emails off stay on the list and keep their access.
  The member page has a "Gets new posts by email" switch, the list a filter and an "emails off"
  label, and Subscribers shows how many have emails off.
- **2026-10-23 — Publish claims the address in place; no profile name in the header.** Publish
  with no address shows the same claim form as Home (`client/site/ClaimName.tsx`); once claimed,
  the site is read again and Publish goes straight on with the open document. The header shows
  the site picker only for a writer on two or more sites, beside the address link: an unclaimed
  site is named after its profile on the platform ("Default"), which meant nothing online.

- **2026-10-25 — Moved into the publish plugin; the desktop gets it.** A desktop writer could
  publish only by asking an agent. The screens moved unchanged from the web app's `client/site/`
  to `plugins/publish/client/` (MIT, with the rest of the plugin), with the Insert block panel and
  the photo upload. The publish plugin is on by default for a writer who never switched it
  (manifest `enabledByDefault`), so Your site and Publish are in the title bar on a fresh install;
  without a key the dashboard opens on its email-code sign-in, which saves the key to the plugin.
  The remembered site moved from one browser key to one per profile: on the desktop all profiles
  share one address, and a test profile's choice must never act on the real site.
