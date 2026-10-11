/**
 * The writer's Anthropic API key, kept on the server only.
 *
 * - One file in the data root (`ai/anthropic-key.json`), written owner-only.
 * - Encrypted (AES-256-GCM) when the machine has `OW_KEY_SECRET`; hosted
 *   machines get it as a Fly secret, so a copy of the volume alone cannot read
 *   the key. Without it (the local app) the file is plain, owner-only.
 * - Never returned to the browser: callers get `describeKey()`, the last four
 *   characters at most. Never logged; errors name the file, not the key.
 * - Never put in process.env: `loadKey()` hands it to the one call that needs it.
 *
 * adr: adr/writer-key-ai.md
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT_DIR } from '../helpers.js';

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

export function aiDir(): string {
  return join(ROOT_DIR, 'ai');
}

function keyFile(): string {
  return join(aiDir(), 'anthropic-key.json');
}

interface StoredKey {
  v: 1;
  last4: string;
  savedAt: string;
  /** Plain key, only when no machine secret exists. */
  key?: string;
  /** AES-256-GCM, base64. */
  iv?: string;
  tag?: string;
  data?: string;
}

function machineSecret(): Buffer | null {
  const s = process.env.OW_KEY_SECRET?.trim();
  return s ? createHash('sha256').update(`openwriter-key-store:${s}`).digest() : null;
}

/** Checks the shape only; Anthropic decides whether the key works. */
export function isPlausibleKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key.trim());
}

export function saveKey(raw: string): { last4: string; encrypted: boolean } {
  const key = raw.trim();
  if (!isPlausibleKey(key)) throw new Error('That does not look like an Anthropic API key (it starts with sk-ant-).');
  const secret = machineSecret();
  const stored: StoredKey = { v: 1, last4: key.slice(-4), savedAt: new Date().toISOString() };
  if (secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secret, iv);
    const data = Buffer.concat([cipher.update(key, 'utf-8'), cipher.final()]);
    stored.iv = iv.toString('base64');
    stored.tag = cipher.getAuthTag().toString('base64');
    stored.data = data.toString('base64');
  } else {
    stored.key = key;
  }
  mkdirSync(aiDir(), { recursive: true, mode: 0o700 });
  // Owner-only from the first byte (the temp file too), then an atomic rename.
  // On Windows the mode is ignored; the user profile folder is already private.
  const tmp = `${keyFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, keyFile());
  return { last4: stored.last4, encrypted: !!secret };
}

function readStored(): StoredKey | null {
  if (!existsSync(keyFile())) return null;
  try {
    const parsed = JSON.parse(readFileSync(keyFile(), 'utf-8'));
    return parsed?.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** The key itself, for the one call that sends it to Anthropic. Null when none is usable. */
export function loadKey(): string | null {
  const stored = readStored();
  if (!stored) return null;
  if (stored.key) return stored.key;
  const secret = machineSecret();
  if (!secret || !stored.iv || !stored.tag || !stored.data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf-8');
  } catch {
    // Secret changed or file damaged: the writer re-enters the key.
    return null;
  }
}

/** What the browser may know about the key. */
export function describeKey(): { saved: boolean; last4?: string; savedAt?: string; usable?: boolean } {
  const stored = readStored();
  if (!stored) return { saved: false };
  return { saved: true, last4: stored.last4, savedAt: stored.savedAt, usable: loadKey() !== null };
}

export function removeKey(): void {
  rmSync(keyFile(), { force: true });
}

/** Strip the key from any text before it reaches a log, a reply or the browser. */
export function redactKey(text: string, key: string | null = loadKey()): string {
  let out = key ? text.split(key).join('[key]') : text;
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]');
  return out;
}
