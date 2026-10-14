/**
 * What Author's Voice uses from OpenWriter, bound once when the plugin registers its routes:
 * the active profile's folder, the data root, the live tool list (read_pad, write_to_pad,
 * get_attribution), creating a document, and the writer's Claude key.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

export const PLUGIN_NAME = '@openwriter/plugin-authors-voice';

export interface ToolDef {
  name: string;
  handler: (params: any) => Promise<any>;
}

export interface VoiceHost {
  /** The active profile's folder (follows a profile switch). */
  dataDir(): string;
  /** OpenWriter's data folder. */
  rootDir(): string;
  tools(): ReadonlyArray<ToolDef>;
  createDocument(body: Record<string, any>): { filename: string; title: string };
  /** OpenWriter's config.json, where the plugin's settings are saved. */
  configFile: string;
  /** The settings the plugin was enabled with. */
  config: Record<string, string>;
}

let bound: VoiceHost | null = null;

export function bindHost(h: VoiceHost): void {
  bound = h;
}

function host(): VoiceHost {
  if (!bound) throw new Error("Author's Voice used before OpenWriter enabled it");
  return bound;
}

export const dataDir = () => host().dataDir();
export const rootDir = () => host().rootDir();
export const tools = () => host().tools();
export const createDocument = (body: Record<string, any>) => host().createDocument(body);
export const aiDir = () => join(rootDir(), 'ai');

/**
 * A setting, read from config.json on every request so a change in the settings panel applies
 * at once (OpenWriter hands a plugin its config only when it is enabled).
 */
export function setting(key: string): string {
  try {
    const cfg = JSON.parse(readFileSync(host().configFile, 'utf8'));
    const v = cfg?.plugins?.[PLUGIN_NAME]?.config?.[key];
    if (typeof v === 'string') return v;
  } catch { /* fall back to the load-time value */ }
  return host().config[key] ?? '';
}

// ─── The writer's Claude key ────────────────────────────────────────────────────

let keyLoader: (() => string | null) | null = null;

/** A program embedding OpenWriter can keep the key itself (the web version encrypts it). */
export function setKeyLoader(fn: (() => string | null) | null): void {
  keyLoader = fn;
}

/** The writer's Anthropic key, or null when none is set. */
export function loadKey(): string | null {
  const k = keyLoader ? keyLoader() : setting('anthropic-api-key').trim();
  return k || null;
}

// ─── Claude ─────────────────────────────────────────────────────────────────────

/** The one Anthropic surface Author's Voice uses, so tests can stand in for it. */
export type MessagesClient = Pick<Anthropic, 'messages'>;
export type ClientFactory = (apiKey: string) => MessagesClient;

let clientFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey, maxRetries: 2 });

export function setClientFactory(f: ClientFactory | null): void {
  clientFactory = f ?? ((apiKey) => new Anthropic({ apiKey, maxRetries: 2 }));
}

export class VoiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const NO_KEY_MESSAGE = "Author's Voice runs on your own Claude API key. Add it in the Author's Voice plugin settings.";

/** A Claude client on the writer's key; a plain "add your key" error without one. */
export function claude(): MessagesClient {
  const key = loadKey();
  if (!key) throw new VoiceError(409, 'no_key', NO_KEY_MESSAGE);
  return clientFactory(key);
}

/** Never show the key in an error the writer reads. */
export function redactKey(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}

/** Plain-language failure for each Anthropic error the writer can act on. */
export function explainApiError(err: unknown): VoiceError {
  if (err instanceof VoiceError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new VoiceError(401, 'key_rejected', 'Anthropic did not accept your API key. Check it in the Author\'s Voice settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new VoiceError(403, 'key_forbidden', 'Your Anthropic key is not allowed to use this model.');
  if (err instanceof Anthropic.RateLimitError) return new VoiceError(429, 'rate_limited', 'Anthropic is rate limiting your key. Try again in a minute.');
  if (err instanceof Anthropic.BadRequestError) {
    const msg = redactKey(String((err as Error).message || ''));
    if (/credit|billing|balance/i.test(msg)) return new VoiceError(402, 'no_credit', 'Your Anthropic account is out of credit. Add credit in the Anthropic console.');
    return new VoiceError(400, 'api_error', `Anthropic refused the request: ${msg}`);
  }
  if (err instanceof Anthropic.APIConnectionError) return new VoiceError(502, 'unreachable', 'Could not reach Anthropic. Try again.');
  if (err instanceof Anthropic.APIError) return new VoiceError(502, 'api_error', `Anthropic error ${err.status ?? ''}`.trim());
  return new VoiceError(500, 'failed', String((err as Error)?.message || 'Author\'s Voice failed.'));
}
