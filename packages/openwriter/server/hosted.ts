/**
 * Hosted mode: this server is one writer's private copy behind the sign-in gateway.
 * The gateway signs every request; this module checks the signature and the one writer
 * the machine serves, and names what hosted mode leaves out.
 * adr: adr/hosted-gateway-trust.md
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IncomingHttpHeaders } from 'http';
import { ROOT_DIR } from './helpers.js';

/** How far the gateway's timestamp may be from this machine's clock. */
export const GATEWAY_MAX_SKEW_SECONDS = 60;

/** Tools that reach the local machine: absent from the tool list in hosted mode. */
export const HOSTED_EXCLUDED_TOOLS = new Set(['open_file', 'reload_from_disk', 'export_manuscript']);

/** Plugins that only make sense on the writer's own computer (git, gh, local X keys). */
export const HOSTED_EXCLUDED_PLUGINS = new Set(['@openwriter/plugin-github', '@openwriter/plugin-x-api']);

/** Settings hosted mode needs; it refuses to start without them. */
export function hostedConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing = ['OW_DATA_DIR', 'OW_GATEWAY_SECRET', 'OW_PUBLIC_URL'].filter((k) => !env[k]?.trim());
  const problems = missing.map((k) => `${k} is not set`);
  if (env.OW_PUBLIC_URL?.trim()) {
    try { new URL(env.OW_PUBLIC_URL); } catch { problems.push('OW_PUBLIC_URL is not a URL'); }
  }
  return problems;
}

/** The public address writers reach this server at, without a trailing slash. */
export function publicUrl(): string {
  return new URL(process.env.OW_PUBLIC_URL!).origin;
}

/** Hex HMAC-SHA256 the gateway sends in X-OW-Gateway. */
export function gatewaySignature(secret: string, user: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${user}.${timestamp}`).digest('hex');
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const v = headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

/** The verified writer id, or null when the signature is missing, wrong or stale. */
export function verifyGatewaySignature(
  headers: IncomingHttpHeaders,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const user = header(headers, 'x-ow-user');
  const timestamp = header(headers, 'x-ow-timestamp');
  const signature = header(headers, 'x-ow-gateway').toLowerCase();
  if (!secret || !user || !/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (Math.abs(nowSeconds - Number(timestamp)) > GATEWAY_MAX_SKEW_SECONDS) return null;
  const expected = Buffer.from(gatewaySignature(secret, user, timestamp), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? user : null;
}

// ---- The one writer this machine serves ----

const ownerFile = () => join(ROOT_DIR, 'hosted-owner.json');
let owner: string | null | undefined;

function readOwner(): string | null {
  try {
    const user = JSON.parse(readFileSync(ownerFile(), 'utf-8'))?.user;
    return typeof user === 'string' && user ? user : null;
  } catch {
    return null;
  }
}

/** True when `user` is this machine's writer. The first verified writer becomes it, for good. */
export function claimOwner(user: string): boolean {
  if (owner === undefined) owner = readOwner();
  if (owner === null) {
    try {
      writeFileSync(ownerFile(), JSON.stringify({ user, claimedAt: new Date().toISOString() }), { flag: 'wx' });
      owner = user;
    } catch {
      owner = readOwner();
      if (owner === null) return false;
    }
  }
  return owner === user;
}

/** Check one request or upgrade: 0 when allowed, else the HTTP status to refuse with. */
export function authorizeGatewayRequest(headers: IncomingHttpHeaders): 0 | 401 | 403 {
  const user = verifyGatewaySignature(headers, process.env.OW_GATEWAY_SECRET ?? '');
  if (!user) return 401;
  return claimOwner(user) ? 0 : 403;
}

/** An Origin or Referer, when present, must be the public address. */
export function isPublicOrigin(value: string): boolean {
  try { return new URL(value).origin === publicUrl(); } catch { return false; }
}
