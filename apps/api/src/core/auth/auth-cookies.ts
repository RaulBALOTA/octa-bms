import type { Request, Response } from 'express';

/**
 * Browser session transport. The refresh token lives only in an httpOnly
 * cookie scoped to the auth routes, so page scripts (and any XSS) never see
 * it; the short-lived access token is kept in memory by the SPA.
 */
export const REFRESH_COOKIE = 'octa_refresh';
const REFRESH_PATH = '/api/v1/auth';

/** SSO anti-CSRF state; Lax because the IdP redirect back is cross-site. */
export const OIDC_STATE_COOKIE = 'octa_oidc_state';
const OIDC_PATH = '/api/v1/auth/oidc';

/**
 * Non-browser clients (scripts, integrations) that cannot keep cookies send
 * `X-Auth-Transport: body` to receive the refresh token in the JSON body.
 */
export function wantsBodyTransport(req: Request): boolean {
  return req.header('X-Auth-Transport')?.toLowerCase() === 'body';
}

function secure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string, maxAgeSeconds: number) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: secure(), sameSite: 'strict', path: REFRESH_PATH });
}

export function setOidcStateCookie(res: Response, state: string) {
  res.cookie(OIDC_STATE_COOKIE, state, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: OIDC_PATH,
    maxAge: 600_000,
  });
}

export function clearOidcStateCookie(res: Response) {
  res.clearCookie(OIDC_STATE_COOKIE, { httpOnly: true, secure: secure(), sameSite: 'lax', path: OIDC_PATH });
}
