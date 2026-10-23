const DEV_SECRET = 'dev-only-secret';
const KNOWN_PLACEHOLDERS = new Set([DEV_SECRET, 'change-me-in-production']);

/**
 * Signing secret for access and refresh tokens. Outside production a fixed dev
 * secret keeps local setups working; in production a missing, placeholder or
 * short secret aborts startup instead of silently issuing forgeable tokens.
 */
export function jwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET;
  if (env.NODE_ENV !== 'production') return secret || DEV_SECRET;
  if (!secret || KNOWN_PLACEHOLDERS.has(secret) || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to a random value of at least 32 characters in production',
    );
  }
  return secret;
}
