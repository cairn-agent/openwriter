/**
 * Format contracts arrive with the document: the first touch of a contracted document (X, blog, newsletter) in an agent session
 * carries its contract in full, later touches a one-line reminder; each type gets its own
 * contracts; every document receives editing guidance. Internal calls get nothing.
 * adr: adr/in-system-guidance.md
 *
 * Isolated home in the temp dir, never ~/.openwriter.
 * Run: `node scripts/test-doc-guidance.mjs` (after `npm run build`)
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const temporaryRoot = mkdtempSync(join(os.tmpdir(), 'ow-doc-guidance-test-'));
os.homedir = () => temporaryRoot;
syncBuiltinESMExports();
process.on('exit', () => { try { rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* best-effort */ } });

const helpers = await import('../dist/server/helpers.js');
helpers.ensureDataDir();
const { TOOL_REGISTRY, appendDocGuidance } = await import('../dist/server/mcp.js');
const { guidanceFor } = await import('../dist/server/doc-guidance.js');

const tool = (name) => TOOL_REGISTRY.find((t) => t.name === name);
/** An agent's call: the tool's result passed through the guidance for that session. */
const agent = async (session, name, args) => appendDocGuidance(session, args, await tool(name).handler(args));
const extra = (result) => result.content.slice(1).map((c) => c.text).join('\n');
const idOf = (result) => /\[([0-9a-f]{8})\]/.exec(result.content[0].text)[1];

// Creating a quote announces the new doc: its first touch carries quote, x-post and thread in full.
const created = await agent('a', 'create_document', { title: 'QT', content_type: 'quote', url: 'https://x.com/someone/status/123', empty: true });
const quote = idOf(created);
let g = extra(created);
assert.match(g, /guidance for [0-9a-f]{8}, an X quote: quote v\d+, x-post v\d+, thread v\d+/);
assert.match(g, /## X quote post/);
assert.match(g, /## X post body/);
assert.match(g, /## X thread/);
assert.match(g, /## Editing and review notes/);
assert.equal(created.content[0].text.startsWith('Created "QT"'), true, 'the tool result itself is unchanged');

// The next touch of the same doc in the same session: one line naming the contract and versions.
g = extra(await agent('a', 'read_pad', { docId: quote }));
assert.match(g, /^\[OpenWriter: [0-9a-f]{8} is an X quote\. Its guidance \(quote v\d+, x-post v\d+, thread v\d+, editing v\d+\) arrived earlier/);
assert.equal(g.split('\n').length, 1, 'reminder is one line');
assert.doesNotMatch(g, /## Editing and review notes/);
g = extra(await agent('a', 'get_metadata', { docId: quote }));
assert.match(g, /arrived earlier/);

// A tweet in the same session: only its own contract arrives; the shared ones are named as sent.
const tweet = idOf(await tool('create_document').handler({ title: 'Thread', content_type: 'tweet', empty: true }));
g = extra(await agent('a', 'peek_doc', { docId: tweet, target: { start: 0, after: 3 } }));
assert.match(g, /## X post \(tweet\)/);
assert.doesNotMatch(g, /## X post body/);
assert.match(g, /Sent earlier in this session: x-post v\d+, thread v\d+/);

// An article gets the article contract only.
const article = idOf(await tool('create_document').handler({ title: 'Long read', content_type: 'article', empty: true }));
g = extra(await agent('a', 'read_pad', { docId: article }));
assert.match(g, /an X article: article v\d+, editing v\d+\. Sent earlier in this session: editing v\d+\.\]/);
assert.match(g, /## X Article/);
assert.doesNotMatch(g, /## X thread/);

// A blog post gets blog and long-form in full, then a reminder.
const blog = idOf(await tool('create_document').handler({ title: 'Launch notes', content_type: 'blog', empty: true }));
g = extra(await agent('d', 'get_metadata', { docId: blog }));
assert.match(g, /a blog post: blog v\d+, long-form v\d+, editing v\d+\.\]/);
assert.match(g, /## Blog post/);
assert.match(g, /## Long-form body/);
assert.doesNotMatch(g, /## X /);
g = extra(await agent('d', 'read_pad', { docId: blog }));
assert.match(g, /^\[OpenWriter: [0-9a-f]{8} is a blog post\. Its guidance \(blog v\d+, long-form v\d+, editing v\d+\) arrived earlier/);
assert.equal(g.split('\n').length, 1, 'reminder is one line');

// A newsletter in the same session: its own contract in full, long-form named as sent.
const issue = idOf(await tool('create_document').handler({ title: 'Issue 12', content_type: 'newsletter', empty: true }));
g = extra(await agent('d', 'read_pad', { docId: issue }));
assert.match(g, /a newsletter issue: newsletter v\d+, long-form v\d+, editing v\d+\. Sent earlier in this session: long-form v\d+, editing v\d+\.\]/);
assert.match(g, /## Newsletter issue/);
assert.doesNotMatch(g, /## Long-form body/);

// Another agent session gets its own full delivery.
g = extra(await agent('b', 'read_pad', { docId: quote }));
assert.match(g, /## X quote post/);

// Every document type gets the shared editing contract; list tools and errors get nothing.
const plain = idOf(await tool('create_document').handler({ title: 'Notes', content_type: 'document', empty: true }));
assert.match(extra(await agent('c', 'read_pad', { docId: plain })), /## Editing and review notes/);
const linkedin = idOf(await tool('create_document').handler({ title: 'Post', content_type: 'linkedin', empty: true }));
assert.match(extra(await agent('c', 'read_pad', { docId: linkedin })), /editing v2.*arrived earlier/);
assert.match(extra(await agent('new-editor', 'read_pad', { docId: linkedin })), /## Editing and review notes/);
assert.equal(extra(await agent('c', 'list_documents', {})), '');
assert.equal(extra(await agent('c', 'read_pad', { docId: 'ffffffff' }).catch(() => ({ content: [{ text: 'Error' }] }))), '');

// OpenWriter's own call path (no agent session) is untouched and does not use up a delivery.
assert.equal((await tool('read_pad').handler({ docId: quote })).content.length, 1);
g = extra(await agent('c', 'read_pad', { docId: quote }));
assert.match(g, /## X quote post/, 'session c still gets the full contract');

console.log('test-doc-guidance: all passed');
for (const type of ['manuscript', undefined, 'future-document-type']) {
  assert.match(guidanceFor(`type-${type}`, 'eeeeeeee', type), /## Editing and review notes/);
  assert.doesNotMatch(guidanceFor(`type-${type}`, 'eeeeeeee', type), /## Editing and review notes/);
}
