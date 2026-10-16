// Synthetic fixtures: no real writing. Runs the real ProseMirror transactions.
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdirSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist', 'tests', 'outline-model.mjs');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, ts.transpileModule(readFileSync(join(root, 'src', 'outline', 'model.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { readOutline, outlineTransaction } = await import(pathToFileURL(out).href);
const attrs = { id: { default: null }, pendingStatus: { default: null }, note: { default: null } };
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' }, text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*', attrs },
    heading: { group: 'block', content: 'inline*', attrs: { ...attrs, level: { default: 2 } } },
    blockquote: { group: 'block', content: 'block+', attrs },
  }, marks: { link: { attrs: { href: {} }, inclusive: false }, strong: {} },
});
const p = (id, text, extra = {}) => schema.node('paragraph', { id, ...extra }, text ? schema.text(text) : undefined);
const h = (id, title, level = 2) => schema.node('heading', { id, level }, schema.text(title));
const link = (id, title, suffix = '') => schema.text(title, [schema.mark('link', { href: `doc:${id}${suffix}` })]);
const linked = (id, source, label) => schema.node('paragraph', { id }, link(source, label));
const make = nodes => EditorState.create({ schema, doc: schema.node('doc', null, nodes), plugins: [history()] });
let state = make([
  p('intro001', 'Opening note'), h('chapter1', 'First'), linked('link0001', '11111111', 'One'),
  h('section1', 'A subsection', 3), p('note0001', 'Keep this note', { note: 'annotation' }),
  linked('link0002', '11111111', 'One again'), h('chapter2', 'Second'), linked('link0003', '22222222', 'Two'),
]);
const baseline = state.doc.toJSON();
const act = action => { state = state.apply(outlineTransaction(state, action)); };
const sections = () => readOutline(state.doc);
assert.equal(sections().length, 3);
assert.equal(sections()[1].subheadings[0].title, 'A subsection');
assert.notEqual(sections()[1].references[0].key, sections()[1].references[1].key);
act({ type: 'moveChapter', key: 'chapter1' });
assert.deepEqual(sections().map(s => s.title), ['Before chapter 1', 'Second', 'First']);
assert(state.doc.textContent.includes('Keep this note'));
assert.equal(sections()[2].subheadings.length, 1);
assert(undo(state, tr => { state = state.apply(tr); }));
assert.deepEqual(state.doc.toJSON(), baseline, 'Undo restores all structure, identities and annotations');
act({ type: 'renameChapter', key: 'chapter1', title: 'Renamed' });
assert.equal(sections()[1].key, 'chapter1');
const first = sections()[1].references[0];
act({ type: 'removeReference', key: first.key });
assert.equal(sections()[1].references.length, 1, 'Only one occurrence removed');
act({ type: 'moveReference', key: sections()[1].references[0].key, chapter: 'chapter2' });
assert.equal(sections()[2].references.length, 2);
act({ type: 'addDocuments', chapter: 'chapter1', documents: [{ docId: '33333333', title: 'Third' }] });
assert.equal(sections()[1].references[0].docId, '33333333');
assert.throws(() => act({ type: 'addDocuments', chapter: 'chapter1', documents: [{ docId: '33333333', title: 'Third' }] }), /already/);
assert.throws(() => act({ type: 'addDocuments', chapter: 'removed', documents: [] }), /removed/);
const pending = make([h('chapter1', 'First'), p('pending1', 'Proposal', { pendingStatus: 'rewrite' }), h('chapter2', 'Second')]);
assert.throws(() => outlineTransaction(pending, { type: 'removeChapter', key: 'chapter1' }), /Review/);
assert.doesNotThrow(() => outlineTransaction(pending, { type: 'renameChapter', key: 'chapter2', title: 'Still editable' }));
state = make([h('chapter1', 'Mixed'), schema.node('paragraph', { id: 'mixed001' }, [schema.text('Before '), link('11111111', 'One', '#aaaaaaaa'), schema.text(' and '), link('22222222', 'Two'), schema.text(' after.')]), h('chapter2', 'Target')]);
act({ type: 'moveReference', key: sections()[0].references[0].key, chapter: 'chapter2' });
assert(state.doc.textContent.includes('Before  and Two after.'), 'Moving a link preserves surrounding prose');
assert.equal(sections()[1].references[0].href, 'doc:11111111#aaaaaaaa', 'Anchor preserved');
state = make([p('empty001', '')]);
assert.equal(sections().length, 0);
act({ type: 'addChapter', title: 'New chapter' });
assert.equal(sections().length, 1, 'Empty initial paragraph does not invent opening material');
unlinkSync(out);
console.log('PASS: outline transactions preserve structure, occurrence identity, Undo, pending boundaries and source links.');
