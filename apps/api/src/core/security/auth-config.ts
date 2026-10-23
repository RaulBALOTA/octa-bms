import { createHash } from 'crypto';

export type MfaMode = 'DISABLED' | 'OPTIONAL' | 'ENROLLMENT_REQUIRED' | 'ENFORCED';

export interface EncryptionKey {
  id: string;
  key: Buffer;
}

export interface AuthConfig {
  production: boolean;
  publicOrigin: string;
  allowedOrigins: string[];
  cookie: { session: string; preAuth: string; oidcState: string; secure: boolean };
  session: { idleMinutes: number; absoluteHours: number; touchIntervalSeconds: number };
  mfa: {
    issuer: string;
    periodSeconds: 30;
    digits: 6;
    window: number;
    defaultMode: MfaMode;
    preAuthTtlSeconds: number;
    enrollTtlSeconds: number;
    maxChallengeAttempts: number;
    stepUpMaxAgeMinutes: number;
  };
  keys: { current: EncryptionKey; previous: EncryptionKey[]; insecureDevKey: boolean };
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  passwordMinLength: number;
  hibpEnabled: boolean;
  resetTokenTtlMinutes: number;
  invitationTtlHours: number;
  trustProxy: string | number | boolean;
  securityEventRetentionDays: number;
  oidcAutoProvision: boolean;
}

export class AuthConfigError extends Error {}

const DEV_KEY_ID = 'dev-insecure';
const MFA_MODES: MfaMode[] = ['DISABLED', 'OPTIONAL', 'ENROLLMENT_REQUIRED', 'ENFORCED'];

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AuthConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseKey(name: string, id: string, raw: string): EncryptionKey {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new AuthConfigError(`${name} must be 32 bytes, base64-encoded`);
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(id)) throw new AuthConfigError(`Key id "${id}" is invalid`);
  return { id, key };
}

function origin(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.origin;
  } catch {
    throw new AuthConfigError(`${name} must be an absolute http(s) URL`);
  }
}

function parseTrustProxy(raw: string | undefined): string | number | boolean {
  if (raw === undefined || raw === '') return 'loopback';
  if (raw === 'false') return false;
  if (raw === 'true') throw new AuthConfigError('TRUST_PROXY=true trusts every hop; set a hop count or subnet list');
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Reads and validates authentication settings. In production, any unsafe value
 * (non-HTTPS origin, missing key, cookie without __Host- prefix, unset TRUST_PROXY)
 * throws so the process refuses to start.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === 'production';
  const publicOrigin = origin(env.APP_PUBLIC_ORIGIN ?? env.APP_URL?.split(',')[0] ?? 'http://localhost:5180', 'APP_PUBLIC_ORIGIN');
  const extra = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((v) => v.trim()).filter(Boolean)
    .map((v) => origin(v, 'CORS_ALLOWED_ORIGINS'));
  if (extra.some((v) => v === '*')) throw new AuthConfigError('Wildcard origins are not allowed');
  const devOrigins = production ? [] : ['http://localhost:5180', 'http://127.0.0.1:5180', 'http://localhost:5181', 'http://127.0.0.1:5181', 'http://localhost:3000'];
  const allowedOrigins = [...new Set([publicOrigin, ...extra, ...devOrigins])];
  const secure = publicOrigin.startsWith('https://');

  const sessionCookie = env.SESSION_COOKIE_NAME ?? (secure ? '__Host-bms_session' : 'bms_session');
  if (!/^[A-Za-z0-9_-]+$/.test(sessionCookie.replace(/^__Host-/, ''))) throw new AuthConfigError('SESSION_COOKIE_NAME is invalid');
  const hostPrefix = sessionCookie.startsWith('__Host-');
  if (hostPrefix && !secure) throw new AuthConfigError('__Host- cookies require an https APP_PUBLIC_ORIGIN');

  let current: EncryptionKey;
  let insecureDevKey = false;
  if (env.AUTH_ENCRYPTION_KEY) {
    current = parseKey('AUTH_ENCRYPTION_KEY', env.AUTH_ENCRYPTION_KEY_ID ?? '', env.AUTH_ENCRYPTION_KEY);
    if (current.id === DEV_KEY_ID) throw new AuthConfigError(`Key id "${DEV_KEY_ID}" is reserved`);
  } else if (production) {
    throw new AuthConfigError('AUTH_ENCRYPTION_KEY and AUTH_ENCRYPTION_KEY_ID are required in production');
  } else {
    // Development only: deterministic key so local enrollments survive restarts.
    // Production refuses to start without a real key and refuses to decrypt with this one.
    current = { id: DEV_KEY_ID, key: createHash('sha256').update('octa-bms-insecure-development-key').digest() };
    insecureDevKey = true;
  }
  const previous = (env.AUTH_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').map((v) => v.trim()).filter(Boolean).map((entry) => {
    const [id, raw] = entry.split(':');
    if (!id || !raw) throw new AuthConfigError('AUTH_ENCRYPTION_PREVIOUS_KEYS must be "id:base64key,…"');
    return parseKey('AUTH_ENCRYPTION_PREVIOUS_KEYS', id, raw);
  });
  if (!production && current.id !== DEV_KEY_ID && !previous.some((k) => k.id === DEV_KEY_ID)) {
    previous.push({ id: DEV_KEY_ID, key: createHash('sha256').update('octa-bms-insecure-development-key').digest() });
  }

  const defaultMode = (env.MFA_REQUIRED_MODE ?? 'optional').toUpperCase() as MfaMode;
  if (!MFA_MODES.includes(defaultMode)) throw new AuthConfigError(`MFA_REQUIRED_MODE must be one of ${MFA_MODES.join(', ').toLowerCase()}`);
  if (env.MFA_TOTP_PERIOD_SECONDS && env.MFA_TOTP_PERIOD_SECONDS !== '30') throw new AuthConfigError('MFA_TOTP_PERIOD_SECONDS must be 30 (Microsoft Authenticator compatibility)');
  if (env.MFA_TOTP_DIGITS && env.MFA_TOTP_DIGITS !== '6') throw new AuthConfigError('MFA_TOTP_DIGITS must be 6 (Microsoft Authenticator compatibility)');

  if (production && env.TRUST_PROXY === undefined) {
    throw new AuthConfigError('TRUST_PROXY must be set explicitly in production (hop count, subnet list, or "false")');
  }
  if (production && !secure) throw new AuthConfigError('APP_PUBLIC_ORIGIN must use https in production');
  if (production && !hostPrefix) throw new AuthConfigError('SESSION_COOKIE_NAME must use the __Host- prefix in production');

  const issuer = (env.MFA_TOTP_ISSUER ?? 'OCTA BMS').trim();
  if (!issuer || issuer.length > 64 || issuer.includes(':')) throw new AuthConfigError('MFA_TOTP_ISSUER must be 1–64 characters without ":"');

  return {
    production,
    publicOrigin,
    allowedOrigins,
    cookie: {
      session: sessionCookie,
      preAuth: hostPrefix ? '__Host-bms_preauth' : 'bms_preauth',
      oidcState: hostPrefix ? '__Host-bms_oidc' : 'bms_oidc',
      secure,
    },
    session: {
      idleMinutes: int(env, 'SESSION_IDLE_MINUTES', 60, 5, 24 * 60),
      absoluteHours: int(env, 'SESSION_ABSOLUTE_HOURS', 12, 1, 24 * 14),
      touchIntervalSeconds: 60,
    },
    mfa: {
      issuer,
      periodSeconds: 30,
      digits: 6,
      window: int(env, 'MFA_TOTP_WINDOW_STEPS', 1, 0, 2),
      defaultMode,
      preAuthTtlSeconds: int(env, 'MFA_PREAUTH_TTL_SECONDS', 300, 60, 900),
      enrollTtlSeconds: int(env, 'MFA_ENROLL_TTL_SECONDS', 900, 300, 3600),
      maxChallengeAttempts: int(env, 'MFA_MAX_CHALLENGE_ATTEMPTS', 5, 3, 10),
      stepUpMaxAgeMinutes: int(env, 'MFA_STEP_UP_MAX_AGE_MINUTES', 10, 1, 60),
    },
    keys: { current, previous, insecureDevKey },
    argon2: {
      memoryCost: int(env, 'ARGON2_MEMORY_KIB', 65_536, 19_456, 1_048_576),
      timeCost: int(env, 'ARGON2_TIME_COST', 3, 2, 10),
      parallelism: int(env, 'ARGON2_PARALLELISM', 4, 1, 16),
    },
    passwordMinLength: int(env, 'PASSWORD_MIN_LENGTH', 12, 12, 64),
    hibpEnabled: env.PASSWORD_HIBP_CHECK === 'true',
    resetTokenTtlMinutes: int(env, 'PASSWORD_RESET_TTL_MINUTES', 30, 10, 120),
    invitationTtlHours: int(env, 'INVITATION_TTL_HOURS', 72, 1, 24 * 14),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    securityEventRetentionDays: int(env, 'SECURITY_EVENT_RETENTION_DAYS', 400, 30, 3650),
    oidcAutoProvision: env.ENTRA_AUTO_PROVISION === 'true',
  };
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export { DEV_KEY_ID };
