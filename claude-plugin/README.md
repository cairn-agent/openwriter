# OpenWriter

OpenWriter is a local markdown editor that Claude writes in. Claude drafts and
edits your documents through OpenWriter's tools, every change shows up in your
browser as a highlighted suggestion, and you accept or reject each one.
Documents are plain `.md` files on your own disk.

## Use it

After you add the plugin, start a new session and ask Claude to write
something in OpenWriter, for example "draft a blog post about our launch in
OpenWriter" or "review my essay in OpenWriter". Open
[http://localhost:5050](http://localhost:5050) in your browser to watch the
edits arrive and accept or reject them. Workspaces, version history, comments,
and tweet and article drafting are all available from the same tools.

The plugin works in Claude Code, and in Cowork when the session runs on your
own computer. It does not work in claude.ai chat, because the editor is a
program that runs on your machine.

## What it runs

- **The OpenWriter server.** The plugin starts the `openwriter` package from
  npm, pinned to the version this plugin was released with, through `npx`.
  It runs on your computer and serves the editor at `localhost:5050`. If an
  OpenWriter server is already running there, the new one passes its tool calls
  to the running one instead of starting a second editor.
- **Two background workers.** There is no skill: the tools, the server's
  instructions and guidance that arrives with each document tell Claude how to
  edit. The workers refresh document summaries
  and file documents you mark for sorting; they only call OpenWriter's own tools.

## Data

Your documents stay on your disk, in `~/.openwriter/`. OpenWriter has no
account and sends no telemetry. It contacts the network only for these:

- the npm registry, to download the package and check for a newer version;
- X (fxtwitter) when you draft a reply or quote of a tweet URL, to show the
  original post;
- your own Git remote, if you turn on Git sync;
- your own GitHub repository, if you post a document to a blog you connected;
- web pages and Google Docs you ask it to read or import;
- publish.openwriter.io, only if you connect a publishing account to schedule
  newsletter or social posts;
- the X API or Google's image API, only if you enable the matching OpenWriter
  add-on in its settings and give it your own key;
- Anthropic's API, only when you run a writing action, on your own Claude key
  (or through publish.openwriter.io on your OpenWriter balance, if you have no key).

## Already using OpenWriter?

If you installed OpenWriter with `npx openwriter setup`, you already have the
server and workers. Adding this plugin as well is harmless (both talk to the same
editor), but one or the other is enough.

## License

MIT. Source: [github.com/travsteward/openwriter](https://github.com/travsteward/openwriter).
