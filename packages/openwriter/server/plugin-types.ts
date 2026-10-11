/**
 * OpenWriter Plugin API types.
 * Plugins extend the editor with routes, MCP tools, and context menu items.
 */

import type { Router } from 'express';

export type PluginCategory = 'writing' | 'social-media' | 'image-generation' | 'publishing' | 'productivity' | 'analytics';

export interface PluginSidebarMenuItem {
  label: string;
  action: string;  // e.g. 'scheduler:schedule-post'
  promptForFocus?: boolean;  // If true, show focus instructions modal before dispatching
  folderCapable?: boolean;  // If true, also offered on workspace/container right-click (applied to every doc in the folder)
}

export interface OpenWriterManifest {
  displayName?: string;
  category?: PluginCategory;
  minVersion?: string;
}

export interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  category?: PluginCategory;
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  mcpTools?(config: Record<string, string>, host: PluginHost): PluginMcpTool[];
  contextMenuItems?(): PluginContextMenuItem[];
  sidebarMenuItems?(): PluginSidebarMenuItem[];
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  env?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface PluginRouteContext {
  app: Router;
  config: Record<string, string>;
  /** The active profile's folder. Read it when a request needs it, never keep a copy: it follows a profile switch. */
  readonly dataDir: string;
  /** OpenWriter's config.json (under ~/.openwriter locally, the data volume when hosted). */
  configFile: string;
  host: PluginHost;
}

/**
 * What a plugin asks OpenWriter to do, called in-process. A plugin never calls
 * the server back over HTTP: a hosted server has no loopback port a plugin
 * could reach, and every route sits behind the gateway signature.
 */
export interface PluginHost {
  /** Merge values into this plugin's saved config (same rules as the settings UI). */
  saveConfig(values: Record<string, string>): { success: boolean; error?: string };
  /** Create a document the way POST /api/documents does; `tab` is the browser tab that asked. */
  createDocument(body: import('./document-create.js').CreateDocumentRequest, tab?: string): { filename: string; title: string };
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginContextMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'empty-node' | 'always';
  promptForInput?: boolean;
}

export interface PluginActionPayload {
  action: string;
  selectedNodes: any[];
  selectedNodeIds: string[];
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  instruction?: string;
}

export interface LoadedPlugin {
  plugin: OpenWriterPlugin;
  config: Record<string, string>;
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  errors: string[];
}

