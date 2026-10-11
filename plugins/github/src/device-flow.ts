/**
 * "Sign in with GitHub" without a client secret: GitHub's device flow.
 * The writer gets a short code, enters it at github.com/login/device in their
 * own browser, and the browser polls this server until GitHub hands over a
 * token. Used by the online copy, where there is no gh CLI. The client id is
 * public (OW_GITHUB_CLIENT_ID); the token is stored by saveToken, never logged.
 * adr: adr/two-way-sync.md
 */

import { saveToken } from './git-sync.js';

const GITHUB = 'https://github.com';

interface PendingLogin { deviceCode: string; interval: number; expiresAt: number }
let pending: PendingLogin | null = null;

export function deviceFlowClientId(): string {
  return process.env.OW_GITHUB_CLIENT_ID?.trim() || '';
}

async function post(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${GITHUB}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok && !body.error) throw new Error(`GitHub returned ${res.status}`);
  return body;
}

/** Ask GitHub for a code the writer types at verificationUri. */
export async function startDeviceFlow(): Promise<{ userCode: string; verificationUri: string; interval: number; expiresIn: number }> {
  const clientId = deviceFlowClientId();
  if (!clientId) throw new Error('Sign in with GitHub is not set up on this server');
  const body = await post('/login/device/code', { client_id: clientId, scope: 'repo' });
  if (body.error) throw new Error(body.error_description || body.error);
  pending = {
    deviceCode: body.device_code,
    interval: Number(body.interval) || 5,
    expiresAt: Date.now() + (Number(body.expires_in) || 900) * 1000,
  };
  return { userCode: body.user_code, verificationUri: body.verification_uri, interval: pending.interval, expiresIn: Number(body.expires_in) || 900 };
}

export type DevicePoll =
  | { status: 'pending'; interval: number }
  | { status: 'done' }
  | { status: 'expired' | 'denied' | 'none' }
  | { status: 'error'; error: string };

/** One check with GitHub. The browser calls this every `interval` seconds; the server runs no timer. */
export async function pollDeviceFlow(): Promise<DevicePoll> {
  if (!pending) return { status: 'none' };
  if (Date.now() > pending.expiresAt) { pending = null; return { status: 'expired' }; }
  const body = await post('/login/oauth/access_token', {
    client_id: deviceFlowClientId(),
    device_code: pending.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (typeof body.access_token === 'string' && body.access_token) {
    pending = null;
    await saveToken(body.access_token, 'device');
    return { status: 'done' };
  }
  switch (body.error) {
    case 'authorization_pending': return { status: 'pending', interval: pending.interval };
    case 'slow_down':
      pending.interval = Number(body.interval) || pending.interval + 5;
      return { status: 'pending', interval: pending.interval };
    case 'expired_token': pending = null; return { status: 'expired' };
    case 'access_denied': pending = null; return { status: 'denied' };
    default: pending = null; return { status: 'error', error: body.error_description || body.error || 'Sign-in failed' };
  }
}
