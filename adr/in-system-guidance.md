# Rules for using a system live in the system and arrive at use

## Context

How an agent must write an X document in OpenWriter (where thread posts split, how paragraphs
and line breaks are stored, where images go, what the reply URL is for, why a doc titled
"Quote Tweet" needs a real name) used to live in a writing skill, /x-writer, beside its voice
and strategy advice. An agent that wrote an X document without opening that skill, or opened
it and skipped the mechanics doc, got the format wrong. The skill also drifted from the app:
by 2026-10-14 it still said markdown `---` makes no rule, markdown images do not work, threads
must not use populate_document, and inserts sharing an anchor land in reverse. None was true
any longer.

## Current invariants

- **Operator decision (2026-10-14):** rules for using a system the operator owns live in that
  system and arrive when the agent touches the relevant object. Skills keep only judgment,
  strategy and cross-system workflow. X documents are the pilot.
- **Contracts are versioned files shipped with the app:** `packages/openwriter/server/guidance/
  <name>.md`, each with `version: N` frontmatter, copied to `dist/server/guidance` by
  `build:guidance`. `server/doc-guidance.ts` maps a content_type to its contracts: tweet,
  reply and quote get their own plus `x-post` (the post body) and `thread`; article gets
  `article`. Other types get none.
- **Written as facts about the document**, not commands: what the document is, how its parts
  are stored and rendered, and what each tool does to it. A fact is only written after it is
  checked against the current code; the contract changes with the code it describes, and its
  version moves when its meaning does.
- **Once, then a reminder, per agent session.** The first tool result that touches a document
  of a contracted type carries every contract for that type not yet sent in full to that
  session; each later touch carries one line naming the contracts and versions. Delivery is
  tracked as name@version, so a new version is sent again in full.
- **A touch** is a call naming the document by docId, or a create_document / open_file whose
  result announces it. Error results get nothing.
- **Delivered where an agent's call enters, never inside the tools**
  (`appendDocGuidance(session, args, result)` in `server/mcp.ts`): the stdio MCP server (one
  session per process), `/api/mcp-call` when the caller names its session in the
  `X-OpenWriter-Session` header (the client-mode proxy sends a per-process id; the editor's
  own HTTP calls send none and get nothing), and an embedder's own agent through the
  `openwriter/server` export. OpenWriter's internal callers (voice indexing reads documents
  through read_pad) must not use up an agent's delivery or see contract text.
- **The contract is an extra content block** after the tool's own result, so a caller reading
  `content[0]` (JSON results, compact reads) is unaffected.
- **MCP instructions say contracts arrive with the document** (`GUIDANCE_NOTICE`, in both the
  stdio server and the client-mode proxy).

## Decision log

- **2026-10-14** — Built for X documents. Rejected: patching each document tool (many sites,
  and plugins' tools would miss it); wrapping the handlers in the registry (voice indexing
  and plugins run the same handlers in-process and would consume the once-per-session
  delivery); once per server process (the local server outlives agent sessions and the hosted
  server serves many chats, so a later session would only ever see the reminder). /x-writer
  lost its mechanics doc and DOC-CONVENTION section; its voice, hooks, strategy and pipeline
  stay. Candidates for the same treatment: newsletter, blog (blogContext, cover image path,
  paywall marker), linkedin, manuscript binding docs.
