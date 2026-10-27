import { useSyncExternalStore } from 'react';
import type { DocumentInfo, WorkspaceWithData } from './sidebar-types';
import { workspaceDocuments } from '../../server/book-workspace-model';

/**
 * The one workspace the sidebar shows, shared by Files, Timeline, Board and the web app's phone
 * home, remembered per browser. DOCUMENTS is the documents in no workspace.
 * adr: adr/workspace-pick.md
 */
export const DOCUMENTS = '__docs__';
const KEY = 'ow-workspace-pick';

const listeners = new Set<() => void>();
let current: string | null = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();

export function getWorkspacePick(): string | null { return current; }

export function setWorkspacePick(pick: string): void {
  if (pick === current) return;
  current = pick;
  try { localStorage.setItem(KEY, pick); } catch { /* private window: this tab still remembers */ }
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The remembered pick, or null before anyone has picked. */
export function useWorkspacePick(): string | null {
  return useSyncExternalStore(subscribe, getWorkspacePick);
}

/** The pick that applies now: a workspace that no longer exists, or none picked yet, shows Documents. */
export function effectivePick(pick: string | null, workspaces: { filename: string }[]): string {
  return pick && workspaces.some(w => w.filename === pick) ? pick : DOCUMENTS;
}

/**
 * Where each document shows: every workspace holding it (its revisions with it), or Documents
 * when none does.
 */
export function pickIndex(docs: DocumentInfo[], workspaces: WorkspaceWithData[]): (filename: string) => string[] {
  const sets = workspaces.map(w => ({
    pick: w.filename,
    files: new Set(w.workspace ? workspaceDocuments(w.workspace, docs).map(d => d.filename) : []),
  }));
  return (filename) => {
    const homes = sets.filter(s => s.files.has(filename)).map(s => s.pick);
    return homes.length ? homes : [DOCUMENTS];
  };
}
