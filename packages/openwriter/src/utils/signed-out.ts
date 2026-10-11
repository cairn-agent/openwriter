/**
 * Hosted mode: when the sign-in gateway (or the writer's machine behind it)
 * answers 401 `signed_out`, the session is gone, so send the writer to sign in.
 *
 * Only that exact answer redirects. Other 401s are ordinary errors (the publish
 * account not connected, a plugin's upstream refusing a key) and the local app
 * never sends `signed_out`. adr: adr/hosted-gateway-trust.md
 */

export const SIGN_IN_PATH = '/_auth/signin';

/** True for the gateway's signed-out answer. Reads a clone, so callers still get the body. */
export async function isSignedOutResponse(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body?.error === 'signed_out';
  } catch {
    return false;
  }
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Wrap window.fetch once at startup so every same-origin call gets the redirect. */
export function installSignedOutRedirect(win: Window & typeof globalThis = window): void {
  const original = win.fetch.bind(win);
  let redirecting = false;
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (!redirecting && isSameOrigin(input) && await isSignedOutResponse(res)) {
      redirecting = true;
      win.location.assign(SIGN_IN_PATH);
    }
    return res;
  };
}
