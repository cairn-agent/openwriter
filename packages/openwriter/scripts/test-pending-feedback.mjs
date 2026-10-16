/** Synthetic pending-note persistence check. Build the server before running. */
import assert from 'node:assert/strict';
import { splitMergedDoc, applyOverlayPure } from '../dist/server/pending-overlay.js';
import { tiptapToMarkdown, markdownToTiptap } from '../dist/server/markdown.js';
import { applyChangesToDoc } from '../dist/server/block-changes.js';

const paragraph = (id, text, attrs = {}) => ({
  type: 'paragraph',
  attrs: { id, ...attrs },
  content: [{ type: 'text', text }],
});

const baseline = paragraph('aaaaaaaa', 'Baseline line.');
const merged = { type: 'doc', content: [
  paragraph('aaaaaaaa', 'Revised line.', {
    pendingStatus: 'rewrite', pendingOriginalContent: baseline,
    pendingFeedback: 'Clarifies the opening.',
  }),
  paragraph('bbbbbbbb', 'Added line.', {
    pendingStatus: 'insert', pendingFeedback: 'Adds a transition.',
  }),
  paragraph('cccccccc', 'Repeated line.', {
    pendingStatus: 'delete', pendingFeedback: 'Repeats the previous point.',
  }),
  paragraph('dddddddd', 'No note.', { pendingStatus: 'insert' }),
] };

const { canonical, overlayEntries } = splitMergedDoc(merged);
assert.deepEqual(overlayEntries.map((entry) => entry.feedback), [
  'Clarifies the opening.', 'Adds a transition.', 'Repeats the previous point.', undefined,
]);
assert.deepEqual(canonical.content.map((node) => node.content?.[0]?.text), [
  'Baseline line.', 'Repeated line.',
]);

const markdown = tiptapToMarkdown(canonical, 'Synthetic document', { docId: 'eeeeeeee' });
assert.doesNotMatch(markdown, /pendingFeedback|Clarifies the opening|Adds a transition|Repeats the previous point/);
const reloaded = applyOverlayPure(
  markdownToTiptap(markdown).document,
  JSON.parse(JSON.stringify(overlayEntries)), // same format as the saved sidecar
);
assert.deepEqual(reloaded.content.map((node) => node.attrs?.pendingFeedback), [
  'Clarifies the opening.', 'Adds a transition.', 'Repeats the previous point.', undefined,
]);
assert.deepEqual(
  applyOverlayPure(reloaded, overlayEntries).content.map((node) => node.attrs?.id),
  reloaded.content.map((node) => node.attrs?.id),
  'reapplying the sidecar must not duplicate pending blocks',
);
const withoutNotes = applyOverlayPure(
  reloaded,
  overlayEntries.map(({ feedback: _feedback, ...entry }) => entry),
);
assert(withoutNotes.content.every((node) => !node.attrs?.pendingFeedback),
  'removing a note from the pending entry clears any stale note on reapply');

console.log('Pending feedback survives sidecar reload and stays out of canonical Markdown.');

// Exercise the real proposal engine, including types that retain their old attrs.
for (const type of ['paragraph', 'heading', 'codeBlock']) {
  const doc = { type: 'doc', content: [{ ...paragraph('12345678', 'Original words.'), type, attrs: { id: '12345678', level: 2 } }] };
  const rewrite = (text, feedback, autoAccept = false) => applyChangesToDoc(doc,
    [{ operation: 'rewrite', nodeId: '12345678', content: paragraph(undefined, text), feedback }], autoAccept);
  rewrite('First proposal.', '  Explains the first edit.  ');
  assert.equal(doc.content[0].attrs.pendingFeedback, 'Explains the first edit.');
  rewrite('Second proposal.');
  assert.equal(doc.content[0].attrs.pendingFeedback, null, `${type}: omission clears the old reason`);
  rewrite('Third proposal.', 'Second reason.');
  assert.equal(doc.content[0].attrs.pendingFeedback, 'Second reason.');
  rewrite('Fourth proposal.', '   ');
  assert.equal(doc.content[0].attrs.pendingFeedback, null);
  rewrite('Fifth proposal.', 'Pending reason.');
  rewrite('Direct commit.', 'Must not survive.', true);
  assert.equal(doc.content[0].content[0].text, 'Direct commit.');
  assert.equal(doc.content[0].attrs.pendingStatus, undefined);
  assert.equal(doc.content[0].attrs.pendingFeedback, undefined);
}

const deletion = { type: 'doc', content: [paragraph('12345678', 'Original.')] };
applyChangesToDoc(deletion, [{ operation: 'delete', nodeId: '12345678', feedback: 'Repeated point.' }]);
assert.equal(deletion.content[0].attrs.pendingFeedback, 'Repeated point.');
applyChangesToDoc(deletion, [{ operation: 'delete', nodeId: '12345678' }]);
assert.equal(deletion.content[0].attrs.pendingFeedback, null);

const direct = { type: 'doc', content: [paragraph('12345678', 'Original.')] };
applyChangesToDoc(direct, [{ operation: 'insert', afterNodeId: '12345678', feedback: 'Ignored.',
  content: paragraph('87654321', 'Committed.', { pendingStatus: 'insert', pendingFeedback: 'Embedded stale note.' }) }], true);
assert.equal(direct.content[1].content[0].text, 'Committed.');
assert.equal(direct.content[1].attrs.pendingFeedback, undefined);
assert.equal(direct.content[1].attrs.pendingStatus, undefined);
console.log('PASS: replacement notes, whitespace, typed blocks, repeat deletes and direct commits.');
