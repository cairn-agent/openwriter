/** Read-only outline preflight and source preview. Uses the existing accepted
 * text compiler; never invents another persisted book model.
 * adr: adr/outline-editor.md */
import { createHash } from 'crypto';
import { filenameByDocId, createDocumentFile } from '../documents.js';
import { getWorkspace, addDoc, writeWorkspace } from '../workspaces.js';
import { broadcastDocumentsChanged, broadcastWorkspacesChanged } from '../ws.js';
import { readFrontmatter } from '../backlinks.js';
import { loadOverlay } from '../pending-overlay.js';
import { loadManifest } from './load.js';
import { parseManifest, compileManuscript } from './index.js';
import { BookError } from './book.js';

const words = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
export function createOutline(title: string, workspaceFile?: string) {
  if (!title.trim()) throw new BookError('Give the outline a title.');
  if (workspaceFile) getWorkspace(workspaceFile); // Validate placement before creating any file.
  const made = createDocumentFile(title.trim(), undefined, { content_type: 'manuscript', manuscriptContext: { active: true } });
  if (workspaceFile) {
    const ws = addDoc(workspaceFile, null, made.filename, made.title);
    if (ws.workspaceType === 'book' && !ws.book?.outlineDocId) {
      ws.book = { ...ws.book, outlineDocId: made.docId };
      writeWorkspace(workspaceFile, ws);
    }
  }
  broadcastDocumentsChanged();
  if (workspaceFile) broadcastWorkspacesChanged();
  return made;
}
export function outlineSource(docId: string) {
  const filename = filenameByDocId(docId);
  const fm = filename ? readFrontmatter(filename) : null;
  if (!filename || !fm) throw new BookError('This source document is missing. Replace or remove its link.', 404);
  return { docId, filename, title: String(fm.data.title || 'Untitled'), text: fm.content, words: words(fm.content), pendingChanges: loadOverlay(docId).length };
}
export function outlineInfo(docId: string) {
  const ms = loadManifest(docId);
  if (!ms) throw new BookError('Choose a book outline.', 404);
  const manifest = parseManifest(ms.body);
  const compiled = compileManuscript(ms.body, ms.meta);
  const ids = [...new Set(manifest.sections.flatMap(s => s.items.flatMap(i => i.docId ? [i.docId] : [])))];
  const sources = ids.map(id => {
    try { const { text: _text, ...source } = outlineSource(id); return source; }
    catch { return { docId: id, title: 'Missing document', filename: '', words: 0, pendingChanges: 0, missing: true }; }
  });
  const chapters: { title: string; words: number; documents: number }[] = [];
  for (const section of manifest.sections) {
    if (section.heading && section.level <= 2) chapters.push({ title: section.heading, words: 0, documents: 0 });
    const chapter = chapters[chapters.length - 1];
    if (!chapter) continue;
    for (const ref of section.items) if (ref.docId) {
      chapter.documents++; chapter.words += sources.find(s => s.docId === ref.docId)?.words || 0;
    }
  }
  return {
    title: compiled.meta.title || 'Book outline', chapters, sources,
    documents: manifest.sections.reduce((n, s) => n + s.items.filter(i => i.kind === 'doc').length, 0),
    totalWords: words(compiled.markdown), emptyChapters: chapters.filter(c => !c.documents).map(c => c.title),
    pendingChanges: loadOverlay(docId).length + sources.reduce((n, s) => n + s.pendingChanges, 0),
    warnings: compiled.warnings,
    // The build must match the review even if an agent edits a source meanwhile.
    revision: createHash('sha256').update(ms.body).update(compiled.markdown).update(JSON.stringify(compiled.meta)).digest('hex'),
  };
}
