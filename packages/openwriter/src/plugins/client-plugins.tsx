/**
 * Client plugin API. A plugin with a `clientModule` (server/plugin-types.ts) has its module
 * imported at page load; the module's default export receives this API and registers UI:
 *
 *   export default function activate(api) {
 *     api.registerRailTab({ id: 'notes', label: 'Notes', icon: '<svg …/>', mount(el, ctx) { … } });
 *   }
 *
 * A plugin mounts its own UI into the element it is given (any library, its own React root), and
 * returns `{ update?(ctx), unmount() }`. It never renders inside the app's React tree, so it
 * cannot break it. adr: adr/open-source-boundary.md
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { showToast } from '../utils/toast';

/** A plugin's mounted view. `update` receives fresh context; `unmount` tears it down. */
export interface MountedView<C> {
  update?(ctx: C): void;
  unmount(): void;
}

export interface RailTabContext {
  /** The open document's docId, or null. */
  docId: string | null;
  /** The open document's filename. */
  filename: string;
  /** Open a rail tab: a built-in id ('review', 'activity', …) or a plugin tab's own id. */
  openTab(id: string): void;
  switchDocument(filename: string): void;
}

export interface PluginRailTab {
  id: string;
  label: string;
  /** 16x16 inline SVG markup for the tab strip (and the titlebar toggle). */
  icon: string;
  /** Lead the tab strip instead of following the built-in tabs. */
  first?: boolean;
  /** A titlebar button that opens this tab, or closes the rail while it is showing. */
  titlebarToggle?: boolean;
  /** While this tab is showing, new pending changes do not switch the rail to Review. */
  holdOpenOnPending?: boolean;
  mount(el: HTMLElement, ctx: RailTabContext): MountedView<RailTabContext>;
}

export interface MenuPanelContext {
  editor: Editor;
  /** The open document's docId (8-hex), when it has one. */
  docId?: string;
  /** The selection captured at right-click. */
  selection: { from: number; to: number; nodes: any[]; nodeIds: string[]; text: string };
  /** Close the context menu. */
  close(): void;
}

export interface PluginMenuPanel {
  id: string;
  /** The context-menu item; choosing it replaces the menu's body with the panel. */
  label: string;
  /** Offer it only for a text selection that overlaps no pending change. */
  needsSelection?: boolean;
  mount(el: HTMLElement, ctx: MenuPanelContext): MountedView<MenuPanelContext>;
}

export interface ClientPluginApi {
  registerRailTab(tab: PluginRailTab): void;
  registerMenuPanel(panel: PluginMenuPanel): void;
  /** Open a rail tab: a built-in id or a plugin tab's own id. */
  openRailTab(id: string): void;
  showToast: typeof showToast;
  /** Called each time the live connection to the server drops. Returns an unsubscribe. */
  onConnectionLost(fn: () => void): () => void;
}

/** Fired on window by the WebSocket client when its socket closes (src/ws/client.ts). */
export const CONNECTION_LOST_EVENT = 'ow-connection-lost';

// ---- Registry ----

interface Registry { railTabs: PluginRailTab[]; menuPanels: PluginMenuPanel[] }
let registry: Registry = { railTabs: [], menuPanels: [] };
const listeners = new Set<() => void>();

function update(next: Partial<Registry>): void {
  registry = { ...registry, ...next };
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The registered plugin UI, re-rendering when a plugin registers more. */
export function useClientPlugins(): Registry {
  return useSyncExternalStore(subscribe, () => registry);
}

/** Rail tab ids for plugin tabs are namespaced so they never collide with built-in ones. */
export function pluginTabId(id: string): `plugin:${string}` {
  return `plugin:${id}`;
}

const BUILT_IN_TABS = new Set(['review', 'versions', 'backlinks', 'exports', 'activity', 'plugins', 'connections', 'appearance']);

/** A built-in id stays as is; anything else names a plugin tab. */
export function resolveTabId(id: string): string {
  return BUILT_IN_TABS.has(id) || id.startsWith('plugin:') ? id : pluginTabId(id);
}

let railOpener: ((id: string) => void) | null = null;

/** Set by the right-rail provider so plugins can open tabs from outside React. */
export function setRailOpener(fn: ((id: string) => void) | null): void {
  railOpener = fn;
}

const api: ClientPluginApi = {
  registerRailTab(tab) {
    update({ railTabs: [...registry.railTabs.filter((t) => t.id !== tab.id), tab] });
  },
  registerMenuPanel(panel) {
    update({ menuPanels: [...registry.menuPanels.filter((p) => p.id !== panel.id), panel] });
  },
  openRailTab(id) {
    railOpener?.(resolveTabId(id));
  },
  showToast,
  onConnectionLost(fn) {
    window.addEventListener(CONNECTION_LOST_EVENT, fn);
    return () => window.removeEventListener(CONNECTION_LOST_EVENT, fn);
  },
};

/** Import every enabled plugin's client module. A module that fails is logged and skipped. */
export async function loadClientPlugins(): Promise<void> {
  let plugins: Array<{ name: string; clientModule?: string }> = [];
  try {
    const res = await fetch('/api/plugins');
    if (!res.ok) return;
    plugins = (await res.json()).plugins || [];
  } catch {
    return;
  }
  for (const p of plugins) {
    if (!p.clientModule) continue;
    try {
      const mod = await import(/* @vite-ignore */ p.clientModule);
      await mod.default?.(api);
    } catch (err) {
      console.error(`[plugins] ${p.name}: client module failed`, err);
    }
  }
}

// ---- Mounting ----

/** Hosts a plugin's view in a plain element: mounts once, passes new context, unmounts. */
export function PluginMount<C>({ mount, ctx, className }: {
  mount: (el: HTMLElement, ctx: C) => MountedView<C>;
  ctx: C;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<MountedView<C> | null>(null);
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    view.current = mount(ref.current!, latest.current);
    return () => { view.current?.unmount(); view.current = null; };
  }, [mount]);
  useEffect(() => { view.current?.update?.(ctx); }, [ctx]);
  return <div ref={ref} className={className} />;
}

/** A plugin's inline SVG icon as a React node. */
export function PluginIcon({ svg }: { svg: string }) {
  return <span className="plugin-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
