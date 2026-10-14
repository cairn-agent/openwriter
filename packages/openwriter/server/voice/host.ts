/**
 * What the voice actions use from OpenWriter: the active profile's folder, the data root, the
 * live tool list (read_pad, write_to_pad, get_attribution), creating a document, and the
 * writer's Claude key and model choice.
 *
 * The key lives in `<data root>/ai/claude.json`, owner-only, and is never sent to the browser.
 * A program embedding OpenWriter can keep it itself (`aiKey` in startOpenWriter's options; the
 * web version encrypts it). adr: adr/authors-voice.md
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getDataDir, readConfig, ROOT_DIR } from '../helpers.js';
import { TOOL_REGISTRY } from '../mcp.js';
import { createDocumentFromRequest } from '../document-create.js';
import { embedOptions } from '../embed-options.js';

export interface ToolDef {
  name: string;
  handler: (params: any) => Promise<any>;
}

export const dataDir = () => getDataDir();
export const rootDir = () => ROOT_DIR;
export const tools = (): ReadonlyArray<ToolDef> => TOOL_REGISTRY;
export const createDocument = (body: Record<string, any>) => createDocumentFromRequest(body as any);
export const aiDir = () => join(rootDir(), 'ai');

// ─── The writer's Claude key and model ──────────────────────────────────────────

interface ClaudeSettings { key?: string; model?: string }

const settingsFile = () => join(aiDir(), 'claude.json');

/** Saved before this was part of OpenWriter, as the Author's Voice plugin's settings. */
function pluginSettings(): ClaudeSettings {
  const c = readConfig().plugins?.['@openwriter/plugin-authors-voice']?.config;
  return { key: c?.['anthropic-api-key']?.trim() || undefined, model: c?.model || undefined };
}

function readSettings(): ClaudeSettings {
  try {
    if (existsSync(settingsFile())) return JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch { /* unreadable: treated as unset */ }
  return pluginSettings();
}

/** Save the key and/or the model; `key: null` removes the key. */
export function saveSettings(update: { key?: string | null; model?: string }): void {
  const next: ClaudeSettings = { ...readSettings() };
  if (update.key === null) delete next.key;
  else if (update.key !== undefined) next.key = update.key.trim();
  if (update.model !== undefined) next.model = update.model;
  mkdirSync(aiDir(), { recursive: true });
  if (!next.key && !next.model) { rmSync(settingsFile(), { force: true }); return; }
  const tmp = `${settingsFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, settingsFile());
  try { chmodSync(settingsFile(), 0o600); } catch { /* Windows: the folder's permissions apply */ }
}

/** True when the embedding program keeps the key, so OpenWriter offers no key setting. */
export const keyManagedElsewhere = () => !!embedOptions().aiKey;

/** The writer's Anthropic key, or null when none is set. */
export function loadKey(): string | null {
  const loader = embedOptions().aiKey;
  const k = loader ? loader() : readSettings().key;
  return k || null;
}

/** The writer's model choice ('' for the default). */
export function modelSetting(): string {
  return readSettings().model || '';
}

/** What the settings panel may show: never the key, only its last four characters. */
export function describeSettings(): { managed: boolean; saved: boolean; last4: string | null; model: string } {
  if (keyManagedElsewhere()) return { managed: true, saved: !!loadKey(), last4: null, model: modelSetting() };
  const key = readSettings().key;
  return { managed: false, saved: !!key, last4: key ? key.slice(-4) : null, model: modelSetting() };
}

export function isPlausibleKey(key: unknown): key is string {
  return typeof key === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

// ─── Claude ─────────────────────────────────────────────────────────────────────

/** The one Anthropic surface the voice actions use, so tests can stand in for it. */
export type MessagesClient = Pick<Anthropic, 'messages'>;
export type ClientFactory = (apiKey: string) => MessagesClient;

const defaultClientFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey, maxRetries: 2 });

export class VoiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const NO_KEY_MESSAGE = 'This runs on your own Claude API key. Add it in Settings, under Claude.';

/** A Claude client on the writer's key; a plain "add your key" error without one. */
export function claude(): MessagesClient {
  const key = loadKey();
  if (!key) throw new VoiceError(409, 'no_key', NO_KEY_MESSAGE);
  return (embedOptions().aiClient ?? defaultClientFactory)(key);
}

/** Never show the key in an error the writer reads. */
export function redactKey(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}

/** Plain-language failure for each Anthropic error the writer can act on. */
export function explainApiError(err: unknown): VoiceError {
  if (err instanceof VoiceError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new VoiceError(401, 'key_rejected', 'Anthropic did not accept your API key. Check it in Settings, under Claude.');
  if (err instanceof Anthropic.PermissionDeniedError) return new VoiceError(403, 'key_forbidden', 'Your Anthropic key is not allowed to use this model.');
  if (err instanceof Anthropic.RateLimitError) return new VoiceError(429, 'rate_limited', 'Anthropic is rate limiting your key. Try again in a minute.');
  if (err instanceof Anthropic.BadRequestError) {
    const msg = redactKey(String((err as Error).message || ''));
    if (/credit|billing|balance/i.test(msg)) return new VoiceError(402, 'no_credit', 'Your Anthropic account is out of credit. Add credit in the Anthropic console.');
    return new VoiceError(400, 'api_error', `Anthropic refused the request: ${msg}`);
  }
  if (err instanceof Anthropic.APIConnectionError) return new VoiceError(502, 'unreachable', 'Could not reach Anthropic. Try again.');
  if (err instanceof Anthropic.APIError) return new VoiceError(502, 'api_error', `Anthropic error ${err.status ?? ''}`.trim());
  return new VoiceError(500, 'failed', redactKey(String((err as Error)?.message || 'The request failed.')));
}
