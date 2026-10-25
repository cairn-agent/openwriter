/**
 * A tab's closing flush (POST /api/flush, server/ws.ts applyTabFlush) lands on the doc the tab
 * names, never on the live doc. Live evidence 2026-10-24: after a restart the server opened the
 * most recently changed doc, and an old tab's flush wrote another doc's text into it.
 *
 * Documents live in a throwaway data folder (OW_DATA_DIR in the temp dir), never ~/.openwriter.
 *
 * Run from packages/openwriter after building the server:
 *   `node scripts/test-flush-target.mjs`
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-flush-target-'));
process.env.OW_DATA_DIR = dataDir;
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { ensureDataDir, resolveDocPath } = await import('../dist/server/helpers.js');
ensureDataDir();
const { createDocumentFromRequest } = await import('../dist/server/document-create.js');
const { getDocId, getTitle } = await import('../dist/server/state.js');
const { resolveDocId } = await import('../dist/server/documents.js');
const { applyTabFlush } = await import('../dist/server/ws.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const onDisk = (docId) => readFileSync(resolveDocPath(resolveDocId(docId)), 'utf-8');
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

createDocumentFromRequest({ title: 'Harbour notes', content: 'Boats came in at dawn.' });
const harbour = getDocId();
createDocumentFromRequest({ title: 'Kitchen notes', content: 'The bread rose twice.' });
const kitchen = getDocId();

console.log('\nTest 1: a flush for a doc that is not live lands on that doc');
assert(getDocId() === kitchen, 'Kitchen notes is live');
assert(applyTabFlush({ tab: 't1', docId: harbour, document: doc('Boats came in at dawn, then the gulls.') }), 'the flush is applied');
assert(/then the gulls/.test(onDisk(harbour)), 'Harbour notes has the flushed text');
assert(/The bread rose twice/.test(onDisk(kitchen)) && !/gulls/.test(onDisk(kitchen)), 'Kitchen notes is untouched');
assert(getTitle() === 'Harbour notes', 'and Harbour notes is live now, like any tab write');

console.log('\nTest 2: a flush that names no doc, or an unknown one, writes nothing');
const before = onDisk(harbour);
assert(!applyTabFlush({ tab: 't1', document: doc('No name on this one.') }), 'no docId is refused');
assert(!applyTabFlush({ tab: 't1', docId: 'ffffffff', document: doc('Nobody owns this.') }), 'an unknown docId is refused');
assert(onDisk(harbour) === before && /The bread rose twice/.test(onDisk(kitchen)), 'both docs are unchanged');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
