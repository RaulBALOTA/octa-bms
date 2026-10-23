import type { CookieOptions, Request, Response } from 'express';
import type { AuthConfig } from './auth-config';

/** HttpOnly; Secure (https origins); SameSite=Strict; Path=/; no Domain (host-only). */
function base(config: AuthConfig): CookieOptions {
  return { httpOnly: true, secure: config.cookie.secure, sameSite: 'strict', path: '/' };
}

export function readCookie(req: Request, name: string): string | undefined {
  const value = (req as Request & { cookies?: Record<string, unknown> }).cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}

export function setSessionCookie(res: Response, config: AuthConfig, token: string, absoluteExpiresAt: Date) {
  res.cookie(config.cookie.session, token, { ...base(config), expires: absoluteExpiresAt });
}

export function setPreAuthCookie(res: Response, config: AuthConfig, token: string, expiresAt: Date) {
  res.cookie(config.cookie.preAuth, token, { ...base(config), expires: expiresAt });
}

export function clearAuthCookies(res: Response, config: AuthConfig) {
  res.clearCookie(config.cookie.session, base(config));
  res.clearCookie(config.cookie.preAuth, base(config));
}

export function clearPreAuthCookie(res: Response, config: AuthConfig) {
  res.clearCookie(config.cookie.preAuth, base(config));
}

/** OIDC state must survive the cross-site redirect back from Entra → SameSite=Lax, 10 min. */
export function setOidcStateCookie(res: Response, config: AuthConfig, value: string) {
  res.cookie(config.cookie.oidcState, value, { httpOnly: true, secure: config.cookie.secure, sameSite: 'lax', path: '/api/v1/auth/oidc', maxAge: 600_000 });
}

export function clearOidcStateCookie(res: Response, config: AuthConfig) {
  res.clearCookie(config.cookie.oidcState, { httpOnly: true, secure: config.cookie.secure, sameSite: 'lax', path: '/api/v1/auth/oidc' });
}
