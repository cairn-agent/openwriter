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

/** The three tabs along the top of Settings (SettingsTab.tsx). */
export type SettingsSection = 'billing' | 'accounts' | 'plugins';

/**
 * Ids that open Settings, and the Settings tab each opens on: the tabs merged into Settings
 * (2026-10-12), when saved or asked for, and the Settings tabs' own names.
 */
const MERGED_INTO_SETTINGS: Record<string, SettingsSection | null> = {
  plugins: 'plugins', connections: 'accounts', appearance: null, billing: 'billing', accounts: 'accounts',
};

export function canonicalTabId(id: string): string {
  return Object.hasOwn(MERGED_INTO_SETTINGS, id) ? 'settings' : id;
}

const SETTINGS_SECTION_EVENT = 'ow-settings-section';
let requestedSection: SettingsSection | null = null;

/** Asked for by id (openRailTab('billing')): Settings opens on that tab. */
export function requestSettingsSection(id: string): void {
  const section = Object.hasOwn(MERGED_INTO_SETTINGS, id) ? MERGED_INTO_SETTINGS[id] : null;
  if (!section) return;
  requestedSection = section;
  window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EVENT, { detail: section }));
}

/** The Settings tab asked for since Settings last looked, once. */
export function takeSettingsSection(): SettingsSection | null {
  const s = requestedSection;
  requestedSection = null;
  return s;
}

export function onSettingsSection(fn: (s: SettingsSection) => void): () => void {
  const listener = (e: Event) => { requestedSection = null; fn((e as CustomEvent<SettingsSection>).detail); };
  window.addEventListener(SETTINGS_SECTION_EVENT, listener);
  return () => window.removeEventListener(SETTINGS_SECTION_EVENT, listener);
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
