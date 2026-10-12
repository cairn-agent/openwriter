/**
 * Tab registry types. One entry per right-rail tab.
 * adr: adr/right-rail.md
 */
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { PendingDocsPayload } from '../ws/client';

/** Tab id — the built-in tabs, plus plugin tabs as `plugin:<id>` (src/plugins/client-plugins.tsx). */
export type TabId =
  | `plugin:${string}`
  | 'review'
  | 'versions'
  | 'backlinks'
  | 'exports'
  | 'activity'
  | 'settings';

/** Tabs merged into Settings (2026-10-12): a saved or requested old id opens Settings. */
const MERGED_INTO_SETTINGS = new Set(['plugins', 'connections', 'appearance']);

export function canonicalTabId(id: string): string {
  return MERGED_INTO_SETTINGS.has(id) ? 'settings' : id;
}

/**
 * Scope determines which app state a tab reads from. The rail container does
 * NOT remount tab bodies on doc switch — doc-scoped tabs receive the new
 * filename/docId via props and decide whether to refetch.
 */
export type TabScope = 'doc' | 'workspace' | 'settings';

/** Props the rail container passes to every tab body. Each tab uses what it needs. */
export interface RightRailTabProps {
  editors: Editor[];
  pendingDocs: PendingDocsPayload;
  currentFilename: string;
  docId: string | null;
  /** The docIds this tab's doc links to (its `references` frontmatter). */
  references?: string[];
  /** Agent-staged title rename for the active doc, or null if none staged.
   *  Owned by App so the value is consistent across surfaces (article title,
   *  Review panel). adr: adr/pending-overlay-model.md */
  pendingTitle?: { from: string; to: string } | null;
  onSwitchDocument: (filename: string) => void;
  sendMessage: (msg: Record<string, any>) => void;
  getDocument: () => any;
  docVersionRef: React.RefObject<number>;
  /** A manuscript's paragraph style for downloads ('spaced' | 'indented'), from manuscriptContext. */
  manuscriptStyle?: string;
}

export interface TabDefinition {
  id: TabId;
  label: string;
  scope: TabScope;
  /** 16x16 inline SVG rendered in the tab strip. Tooltip uses `label`. */
  icon: ReactNode;
  /** The tab body. Receives the full prop bag; uses what it needs. */
  Component: (props: RightRailTabProps) => JSX.Element | null;
  /** Plugin tabs: a titlebar button opens this tab, or closes the rail while it shows. */
  titlebarToggle?: boolean;
  /** Plugin tabs: while this tab shows, new pending changes do not switch to Review. */
  holdOpenOnPending?: boolean;
}
