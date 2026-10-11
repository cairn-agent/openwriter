/**
 * The trust boundary every HTTP route sits behind: the loopback Host and Origin
 * check locally, the gateway signature in hosted mode, and the security headers.
 * adr: adr/hosted-gateway-trust.md
 */

import type express from 'express';
import { authorizeGatewayRequest, isPublicOrigin } from './hosted.js';
import { HOSTED } from './helpers.js';

// ---- Trust boundary (anti-DNS-rebinding + CSRF) — MCP-5 ----
// The HTTP API binds to loopback and historically trusted "localhost = the
// user." That is false: with no Host/Origin validation a remote website can
// reach this API via DNS rebinding (its page rebinds a hostname to 127.0.0.1,
// the browser keeps sending the attacker's Host/Origin) and drive every
// mutating route — switch profiles, enable plugins, rewrite plugin config.
// The middleware below is the single gate for ALL routes. adr: see MCP-5.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Split a Host header into hostname + optional port, handling [::1]:port. */
function splitHostHeader(hostHeader: string): { host: string; port?: string } {
  if (hostHeader.startsWith('[')) {
    const close = hostHeader.indexOf(']');
    if (close === -1) return { host: hostHeader };
    const host = hostHeader.slice(1, close);
    const rest = hostHeader.slice(close + 1);
    return { host, port: rest.startsWith(':') ? rest.slice(1) : undefined };
  }
  const colon = hostHeader.lastIndexOf(':');
  if (colon === -1) return { host: hostHeader };
  return { host: hostHeader.slice(0, colon), port: hostHeader.slice(colon + 1) };
}

/** True when the Host header names loopback on the port we are serving. */
function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const { host, port: p } = splitHostHeader(hostHeader.trim());
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) return false;
  if (p !== undefined && p !== String(port)) return false;
  return true;
}

/** True when an Origin/Referer URL is same-origin (loopback on our port). */
function isAllowedOrigin(value: string | undefined, port: number): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return false;
    if (u.port && u.port !== String(port)) return false;
    return true;
  } catch {
    return false;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global security gate, applied before any route or body parsing.
 *  (a) Host allowlist — the anti-DNS-rebinding control.
 *  (b) Origin/Referer same-origin check on state-changing methods (CSRF).
 *      Browsers always send Origin on cross-origin POST, so a rebound page is
 *      rejected here too. A *missing* Origin is allowed only for state-changing
 *      requests from non-browser local clients (the client-mode MCP-over-HTTP
 *      proxy uses curl-style requests with no Origin); the Host gate still
 *      bounds those to loopback.
 *  (c) Restrictive security headers on every response.
 */
export function securityGate(port: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
    );

    // Hosted mode swaps the loopback Host check for the gateway's signed
    // identity — one or the other, never neither. adr: adr/hosted-gateway-trust.md
    if (HOSTED) {
      const refusal = authorizeGatewayRequest(req.headers);
      if (refusal) { res.status(refusal).json({ error: refusal === 401 ? 'Unauthorized' : 'Forbidden' }); return; }
    } else if (!isAllowedHost(req.headers.host, port)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (STATE_CHANGING.has(req.method)) {
      const origin = req.headers.origin;
      const referer = req.headers.referer;
      const sameOrigin = (v: string) => (HOSTED ? isPublicOrigin(v) : isAllowedOrigin(v, port));
      if (origin) {
        if (!sameOrigin(origin)) { res.status(403).json({ error: 'Forbidden' }); return; }
      } else if (referer) {
        if (!sameOrigin(referer)) { res.status(403).json({ error: 'Forbidden' }); return; }
      }
      // No Origin and no Referer: non-browser local client; Host gate above
      // already constrained it to loopback. Allow.
    }

    next();
  };
}
