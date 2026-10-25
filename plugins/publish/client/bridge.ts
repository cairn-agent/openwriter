/**
 * The site screens' one door into OpenWriter: the client plugin API handed to this module at
 * activation, read as React hooks. What the screens show about the open document comes from the
 * app's snapshot; every site action is a publish tool run through /api/mcp-call.
 */
import { useSyncExternalStore } from 'react';
import type { AppSnapshot, ClientPluginApi } from '@openwriter-src/plugins/client-plugins';

let api: ClientPluginApi | null = null;

export function setApi(a: ClientPluginApi): void {
  api = a;
}

export function owApi(): ClientPluginApi {
  if (!api) throw new Error('site screens used before the publish client module activated');
  return api;
}

function subscribe(fn: () => void): () => void {
  return owApi().onAppChange(fn);
}

/** The app's snapshot: the editor, the open document, the connection, pending documents. */
export function useApp(): AppSnapshot {
  return useSyncExternalStore(subscribe, () => owApi().getApp());
}

/** Same-origin fetch that names this tab, for routes that act on the document a tab shows. */
export function tabFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-OW-Tab', owApi().tabId);
  return fetch(input, { ...init, headers });
}

/**
 * Run one of OpenWriter's tools (the list the agents see) through /api/mcp-call and return
 * its parsed result. A tool's error result throws with its message.
 */
export async function callTool<T = any>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await tabFetch('/api/mcp-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, arguments: args }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${tool} failed (${res.status})`);
  const text = data?.content?.[0]?.text;
  let parsed: any = data;
  if (typeof text === 'string') {
    try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  }
  if (data?.isError || parsed?.success === false || (parsed?.error && !parsed?.success)) {
    throw new Error(parsed?.error || parsed?.text || `${tool} failed`);
  }
  return parsed as T;
}
