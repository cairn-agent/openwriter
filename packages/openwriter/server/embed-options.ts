/**
 * Settings a program embedding OpenWriter passes to startOpenWriter (server/embed.ts). Read by
 * the request gate, the WebSocket upgrade, the tool registry and plugin discovery. Unset, the
 * local app behaves as it always has. adr: adr/open-source-boundary.md
 */

import type { IncomingMessage } from 'http';
import type { OpenWriterPlugin } from './plugin-types.js';
import type { ClientFactory } from './voice/host.js';

/** A refusal: the status and JSON body sent back instead of running the request. */
export interface GateRefusal {
  status: number;
  body: unknown;
}

export interface EmbedOptions {
  /**
   * Sees every HTTP request and WebSocket upgrade before any route. Return a refusal to stop it,
   * or null to let it through. When set it replaces the loopback Host check.
   */
  requestGate?: (req: IncomingMessage) => GateRefusal | null;
  /**
   * The origin browsers reach this server at (e.g. `https://writer.example`). When set it
   * replaces the loopback Origin check and is the base URL the server hands out.
   */
  publicOrigin?: string;
  /** False removes a tool from every tool list. `plugin` names the plugin that brought it. */
  toolFilter?: (tool: { name: string; plugin?: string }) => boolean;
  /** False hides a discovered plugin entirely. */
  pluginFilter?: (plugin: { name: string; source: 'bundled' | 'user' }) => boolean;
  /** Plugin objects loaded in-process, beside the discovered ones, and enabled at start. */
  plugins?: OpenWriterPlugin[];
  /**
   * The writer's Claude key, kept by the embedding program (encrypted, say). When set, OpenWriter
   * offers no key setting and never stores one. adr: adr/authors-voice.md
   */
  aiKey?: () => string | null;
  /** Stands in for Anthropic (tests). */
  aiClient?: ClientFactory;
}

let current: EmbedOptions = {};

export function setEmbedOptions(options: EmbedOptions): void {
  current = options;
}

export function embedOptions(): EmbedOptions {
  return current;
}
