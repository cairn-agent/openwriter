/**
 * Right-rail tab registry. Order here is the order tabs render in the strip.
 *
 * Order is user-priority, not scope: Review → Activity → Backlinks → Exports
 * are the day-to-day primary actions; Versions → Settings are history and
 * setup (Settings holds Appearance, Connections and Plugins). A single visual
 * divider sits between Exports and Versions to mark that transition.
 *
 * Review leads the strip because pending agent writes are the most time-
 * sensitive surface. Activity sits second as the workspace-wide log; it
 * remains the first-run default tab (rail opens to Activity) — strip order
 * and default tab are independent decisions.
 *
 * Adding a tab: add an entry here, that's it. The container reads this
 * registry — no wiring elsewhere. Plugins add tabs through the client plugin
 * API; useRailTabs() merges them in (adr/open-source-boundary.md).
 *
 * adr: adr/right-rail.md
 */
import { useMemo } from 'react';
import type { RightRailTabProps, TabDefinition, TabId } from './types';
import { PluginIcon, PluginMount, pluginTabId, resolveTabId, useClientPlugins, type PluginRailTab, type RailTabContext } from '../plugins/client-plugins';
import { useRightRail } from './RightRailContext';
import {
  ReviewIcon,
  VersionsIcon,
  BacklinksIcon,
  ExportsIcon,
  ActivityIcon,
  SettingsIcon,
} from './icons';
import ReviewTab from './tabs/ReviewTab';
import VersionsTab from './tabs/VersionsTab';
import BacklinksTab from './tabs/BacklinksTab';
import ExportsTab from './tabs/ExportsTab';
import ActivityTab from './tabs/ActivityTab';
import SettingsTab from './tabs/SettingsTab';

export const TAB_REGISTRY: TabDefinition[] = [
  { id: 'review',      label: 'Review',      scope: 'doc',       icon: <ReviewIcon />,      Component: ReviewTab },
  { id: 'activity',    label: 'Activity',    scope: 'workspace', icon: <ActivityIcon />,    Component: ActivityTab },
  { id: 'backlinks',   label: 'Backlinks',   scope: 'doc',       icon: <BacklinksIcon />,   Component: BacklinksTab },
  { id: 'exports',     label: 'Export',      scope: 'doc',       icon: <ExportsIcon />,     Component: ExportsTab },
  { id: 'versions',    label: 'Versions',    scope: 'doc',       icon: <VersionsIcon />,    Component: VersionsTab },
  { id: 'settings',    label: 'Settings',    scope: 'settings',  icon: <SettingsIcon />,    Component: SettingsTab },
];

/** A plugin tab's body: the rail's props become the plugin's context. */
function PluginTabBody({ tab, docId, currentFilename, onSwitchDocument }: RightRailTabProps & { tab: PluginRailTab }) {
  const { openTab } = useRightRail();
  const ctx = useMemo<RailTabContext>(() => ({
    docId,
    filename: currentFilename,
    openTab: (id) => openTab(resolveTabId(id) as TabId),
    switchDocument: onSwitchDocument,
  }), [docId, currentFilename, openTab, onSwitchDocument]);
  return <PluginMount mount={tab.mount} ctx={ctx} className="plugin-rail-tab" />;
}

// One stable definition per registered plugin tab, so its body is not remounted on re-render.
const pluginDefinitions = new WeakMap<PluginRailTab, TabDefinition>();
function pluginDefinition(tab: PluginRailTab): TabDefinition {
  let def = pluginDefinitions.get(tab);
  if (!def) {
    def = {
      id: pluginTabId(tab.id),
      label: tab.label,
      scope: 'doc',
      icon: <PluginIcon svg={tab.icon} />,
      Component: (props) => <PluginTabBody {...props} tab={tab} />,
      titlebarToggle: tab.titlebarToggle,
      holdOpenOnPending: tab.holdOpenOnPending,
    };
    pluginDefinitions.set(tab, def);
  }
  return def;
}

/** The built-in tabs with plugin tabs merged in (`first` ones lead, the rest follow). */
export function useRailTabs(): TabDefinition[] {
  const { railTabs } = useClientPlugins();
  return useMemo(() => {
    if (railTabs.length === 0) return TAB_REGISTRY;
    const first = railTabs.filter((t) => t.first).map(pluginDefinition);
    const rest = railTabs.filter((t) => !t.first).map(pluginDefinition);
    return [...first, ...TAB_REGISTRY, ...rest];
  }, [railTabs]);
}

export function findTab(id: TabId | null, tabs: TabDefinition[] = TAB_REGISTRY): TabDefinition | null {
  if (!id) return null;
  return tabs.find((t) => t.id === id) ?? null;
}
