// Synthetic fixtures only. Actual MCP handlers, canonical files and persisted sidecars.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixture = mkdtempSync(join(tmpdir(), 'ow-feedback-service-'));
process.env.OW_DATA_DIR = fixture;
const helpers = await import('../dist/server/helpers.js');
const state = await import('../dist/server/state.js');
const docs = await import('../dist/server/documents.js');
const overlay = await import('../dist/server/pending-overlay.js');
const { parseMarkdownContent } = await import('../dist/server/compact.js');
const { tiptapToMarkdown } = await import('../dist/server/markdown.js');
const { TOOL_REGISTRY, appendDocGuidance } = await import('../dist/server/mcp.js');
const { z } = await import('zod');
helpers.ensureDataDir(); helpers.ensureWorkspacesDir();
const tool = name => TOOL_REGISTRY.find(t => t.name === name);
const call = async (name, args) => appendDocGuidance('feedback-service', args,
  await tool(name).handler(z.object(tool(name).schema).parse(args)));
const create = title => {
  const record = docs.createDocumentFile(title);
  const document = { type: 'doc', content: parseMarkdownContent('## Original heading\n\nOriginal paragraph.\n\nAnother paragraph.') };
  writeFileSync(join(helpers.getDataDir(), record.filename), tiptapToMarkdown(document, title, { docId: record.docId, title }));
  state.invalidateDocCache(record.filename);
  return record;
};
const disk = record => readFileSync(join(helpers.getDataDir(), record.filename), 'utf8');
const loaded = record => overlay.loadDocFromDisk(record.filename).document;
const all = document => {
  const result = [];
  const walk = nodes => nodes.forEach(n => { result.push(n); if (n.content) walk(n.content); });
  walk(document.content); return result;
};
try {
  const active = create('Synthetic active review');
  const background = create('Synthetic background review');
  docs.switchDocument(active.filename);
  const first = await call('read_pad', { docId: active.docId });
  assert.match(first.content[1].text, /## Editing and review notes/);
  for (const record of [active, background]) {
    const heading = loaded(record).content.find(n => n.type === 'heading');
    const write = async (content, feedback) => {
      const result = await call('write_to_pad', { docId: record.docId, changes: [
        { operation: 'rewrite', nodeId: heading.attrs.id, content, feedback },
      ] });
      assert.equal(JSON.parse(result.content[0].text).appliedCount, 1);
      if (record === active) state.save('agent');
    };
    await write('Proposed heading', 'Clarifies the topic.');
    assert.equal(overlay.loadOverlay(record.docId)[0].feedback, 'Clarifies the topic.');
    assert.equal(loaded(record).content[0].attrs.pendingFeedback, 'Clarifies the topic.');
    assert.doesNotMatch(disk(record), /Clarifies the topic|pendingFeedback|Proposed heading/);
    await write('Replacement heading');
    assert.equal(overlay.loadOverlay(record.docId)[0].feedback, undefined);
    assert.equal(loaded(record).content[0].attrs.pendingFeedback, null);
    await write('Final proposed heading', 'A different editorial reason.');
    const result = docs.batchResolve([record.filename], 'accept');
    assert.equal(result.docsResolved, 1);
    assert.match(disk(record), /Final proposed heading/);
    assert.doesNotMatch(disk(record), /editorial reason|pendingFeedback/);
    assert.equal(overlay.loadOverlay(record.docId).length, 0);
    assert(all(loaded(record)).every(n => !n.attrs?.pendingFeedback));
  }
  docs.switchDocument(active.filename);
  const paragraph = state.getDocument().content.find(n => n.type === 'paragraph' && n.content?.length);
  const beforeReject = disk(active);
  await call('write_to_pad', { docId: active.docId, changes: [
    { operation: 'rewrite', nodeId: paragraph.attrs.id, content: 'Rejected proposal.', feedback: 'Explains the rewrite.' },
    { operation: 'insert', afterNodeId: 'end', content: 'Rejected addition.', feedback: 'Explains the addition.' },
  ] });
  state.save('agent');
  assert.equal(overlay.loadOverlay(active.docId).length, 2);
  docs.batchResolve([active.filename], 'reject');
  assert.doesNotMatch(disk(active), /Rejected proposal|Rejected addition|Explains|pendingFeedback/);
  assert.match(disk(active), /Original paragraph/);
  assert.equal(overlay.loadOverlay(active.docId).length, 0);
  assert(all(loaded(active)).every(n => !n.attrs?.pendingFeedback));
  assert.match(beforeReject, /Original paragraph/);
  assert.throws(() => z.object(tool('write_to_pad').schema).parse({ docId: active.docId,
    changes: [{ operation: 'delete', nodeId: paragraph.attrs.id, feedback: 'x'.repeat(501) }] }));
  console.log('PASS: real MCP active/background replacement, disk reload, bulk accept/reject, canonical separation and bounded notes.');
} finally {
  state.cancelDebouncedSave();
  rmSync(fixture, { recursive: true, force: true });
}
