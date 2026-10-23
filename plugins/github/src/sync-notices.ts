/**
 * What a sync changed under the writer, so it is never silent: a paragraph
 * replaced by another device's newer version ("Updated from Maya's laptop,
 * 3:12 PM · Undo · See earlier version") and the open document deleted on
 * another device ("Deleted on Web · Undo"). Kept per data folder inside .git,
 * so they stay on this copy and are never synced. adr: adr/two-way-sync.md
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface SyncNotice {
  id: string;
  kind: 'replaced' | 'deleted';
  /** Data-folder path of the document, and its id and title when known. */
  file: string;
  docId?: string;
  title?: string;
  /** The device that made the change, and when (ISO). */
  device: string;
  time: string;
  /** replaced: the lines now in the document, the lines Undo puts back, and the line before them. */
  kept?: string[];
  earlier?: string[];
  anchor?: string;
  /** deleted: the commit that still has the document. */
  restoreFrom?: string;
}

const FILE = 'openwriter-notices.json';
/** The newest this many stay; older ones drop off. */
const KEEP = 50;

export function readNotices(dir: string): SyncNotice[] {
  try {
    const list = JSON.parse(readFileSync(join(dir, '.git', FILE), 'utf-8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeNotices(dir: string, list: SyncNotice[]): void {
  try { writeFileSync(join(dir, '.git', FILE), JSON.stringify(list.slice(-KEEP))); } catch { /* best-effort */ }
}

export function noticeId(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
}

export function addNotices(dir: string, notices: SyncNotice[]): void {
  if (notices.length === 0) return;
  const list = readNotices(dir);
  const have = new Set(list.map((n) => n.id));
  writeNotices(dir, [...list, ...notices.filter((n) => !have.has(n.id))]);
}

export function removeNotice(dir: string, id: string): SyncNotice | undefined {
  const list = readNotices(dir);
  const found = list.find((n) => n.id === id);
  if (found) writeNotices(dir, list.filter((n) => n.id !== id));
  return found;
}
