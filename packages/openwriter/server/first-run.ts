/**
 * `firstRunDocuments` (embed option): documents a program embedding OpenWriter writes into a new
 * data folder, such as a welcome document. Written once: a marker in the profile folder records
 * that the folder has had its first run, so a document the writer deletes never comes back.
 * A folder that already holds documents gets the marker and nothing else.
 * adr: adr/open-source-boundary.md
 */

import { existsSync, readdirSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FirstRunDocument } from './embed-options.js';
import { atomicWriteFileSync, ensureDataDir, filePathForTitle, generateNodeId, getDataDir, TEMP_PREFIX } from './helpers.js';
import { markdownToTiptap, tiptapToMarkdownChecked } from './markdown.js';

const MARKER = '.first-run';

export function seedFirstRunDocuments(docs: FirstRunDocument[]): void {
  ensureDataDir();
  const dir = getDataDir();
  const marker = join(dir, MARKER);
  if (existsSync(marker)) return;

  const hasDocuments = readdirSync(dir).some((f) => f.endsWith('.md') && !f.startsWith(TEMP_PREFIX));
  if (!hasDocuments) {
    // The first document is the newest, so it is the one that opens.
    const now = Date.now() / 1000;
    docs.forEach((doc, i) => {
      const path = filePathForTitle(doc.title);
      if (existsSync(path)) return;
      const { document } = markdownToTiptap(doc.markdown);
      const { markdown } = tiptapToMarkdownChecked(document, doc.title, { title: doc.title, docId: generateNodeId() });
      atomicWriteFileSync(path, markdown);
      utimesSync(path, now - i, now - i);
    });
  }
  writeFileSync(marker, `${new Date().toISOString()}\n`);
}
