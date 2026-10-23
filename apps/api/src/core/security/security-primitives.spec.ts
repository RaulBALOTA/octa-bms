import { describe, expect, it } from 'vitest';
import { HOTP, Secret } from 'otpauth';
import { AuthConfigError, loadAuthConfig } from './auth-config';
import { DecryptionError, KeyRing, hashToken, ipBucket, ipPrefix, normalizeRecoveryCode, randomRecoveryCode, randomToken } from './crypto';
import { PasswordService } from './password.service';
import { sanitizeContext } from './security-audit.service';
import { TotpService } from './totp.service';

const devConfig = loadAuthConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');
const prodEnv = {
  NODE_ENV: 'production',
  APP_PUBLIC_ORIGIN: 'https://bms.example.invalid',
  AUTH_ENCRYPTION_KEY: key(7),
  AUTH_ENCRYPTION_KEY_ID: 'key-v1',
  TRUST_PROXY: '1',
} as NodeJS.ProcessEnv;

describe('TOTP (RFC 6238 / Microsoft Authenticator profile)', () => {
  const totp = new TotpService(devConfig);
  // RFC 6238 Appendix B, SHA-1 seed "12345678901234567890"
  const rfcSecret = new Secret({ buffer: new TextEncoder().encode('12345678901234567890').buffer as ArrayBuffer }).base32;
  const vectors: [number, string][] = [
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
  ];

  it.each(vectors)('matches the RFC 6238 vector at T=%i', (time, expected) => {
    expect(totp.generate(rfcSecret, Math.floor(time / 30), 8)).toBe(expected);
    // 6-digit (Authenticator) codes are the low 6 digits of the same truncation
    expect(totp.generate(rfcSecret, Math.floor(time / 30))).toBe(expected.slice(2));
  });

  it('agrees with an independent HOTP implementation', () => {
    const secret = totp.generateSecret();
    const step = totp.currentStep();
    expect(totp.generate(secret, step)).toBe(HOTP.generate({ secret: Secret.fromBase32(secret), counter: step, digits: 6, algorithm: 'SHA1' }));
  });

  it('generates 160-bit Base32 secrets from a CSPRNG', () => {
    const a = totp.generateSecret();
    const b = totp.generateSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
  });

  it('builds a Microsoft Authenticator compatible otpauth URI', () => {
    const uri = new URL(totp.provisioningUri('JBSWY3DPEHPK3PXP', 'jane.doe@octa.example'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/OCTA BMS:jane.doe@octa.example');
    expect(uri.searchParams.get('issuer')).toBe('OCTA BMS');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });

  it('renders the QR code locally as SVG', async () => {
    const svg = await totp.qrSvg(totp.provisioningUri(totp.generateSecret(), 'a@b.example'));
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('accepts ±1 step, rejects older-than-last-used, malformed and out-of-window codes', () => {
    const secret = totp.generateSecret();
    const now = Date.now();
    const step = totp.currentStep(now);
    expect(totp.match(secret, totp.generate(secret, step), 0, now)).toBe(step);
    expect(totp.match(secret, totp.generate(secret, step - 1), 0, now)).toBe(step - 1);
    expect(totp.match(secret, totp.generate(secret, step + 1), 0, now)).toBe(step + 1);
    expect(totp.match(secret, totp.generate(secret, step - 2), 0, now)).toBeNull();
    expect(totp.match(secret, totp.generate(secret, step), step, now)).toBeNull(); // replay
    expect(totp.match(secret, totp.generate(secret, step - 1), step, now)).toBeNull(); // older code after newer
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 345', '1'.repeat(1000)]) expect(totp.match(secret, bad, 0, now)).toBeNull();
  });
});

describe('seed encryption (AES-256-GCM key ring)', () => {
  const ring = new KeyRing({ current: { id: 'k2', key: Buffer.alloc(32, 2) }, previous: [{ id: 'k1', key: Buffer.alloc(32, 1) }], insecureDevKey: false }, true);

  it('round-trips and binds ciphertext to its associated data', () => {
    const { ciphertext, keyId } = ring.encrypt('JBSWY3DPEHPK3PXP', 'mfa-totp:user-a:auth-1');
    expect(keyId).toBe('k2');
    expect(ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(ring.decrypt(ciphertext, 'mfa-totp:user-a:auth-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => ring.decrypt(ciphertext, 'mfa-totp:user-b:auth-1')).toThrow(DecryptionError);
  });

  it('uses a unique nonce per encryption and detects tampering', () => {
    const a = ring.encrypt('same', 'aad').ciphertext;
    const b = ring.encrypt('same', 'aad').ciphertext;
    expect(a).not.toBe(b);
    const parts = a.split('.');
    const body = Buffer.from(parts[3], 'base64url');
    body[0] ^= 1;
    expect(() => ring.decrypt([...parts.slice(0, 3), body.toString('base64url')].join('.'), 'aad')).toThrow(DecryptionError);
  });

  it('decrypts with previous keys and flags them for re-encryption', () => {
    const old = new KeyRing({ current: { id: 'k1', key: Buffer.alloc(32, 1) }, previous: [], insecureDevKey: false }, true).encrypt('seed', 'aad').ciphertext;
    expect(ring.decrypt(old, 'aad')).toBe('seed');
    expect(ring.needsReencryption(old)).toBe(true);
  });

  it('refuses the development key in production', () => {
    const dev = new KeyRing(devConfig.keys, false).encrypt('seed', 'aad').ciphertext;
    const prod = new KeyRing({ ...devConfig.keys, current: { id: 'k9', key: Buffer.alloc(32, 9) }, previous: [devConfig.keys.current] }, true);
    expect(() => prod.decrypt(dev, 'aad')).toThrow(DecryptionError);
  });
});

describe('tokens and recovery codes', () => {
  it('produces 256-bit tokens and domain-separated hashes', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashToken('session', token)).not.toBe(hashToken('password-reset', token));
    expect(hashToken('session', token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('formats and normalizes recovery codes', () => {
    const code = randomRecoveryCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    expect(normalizeRecoveryCode(code.toLowerCase().replace('-', ' '))).toBe(code.replace('-', ''));
    expect(normalizeRecoveryCode('O0I1O-0I1O0')).toBeNull();
    expect(normalizeRecoveryCode('x'.repeat(200))).toBeNull();
  });

  it('coarsens IPs for storage and buckets IPv6 by /64', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('2001:db8:1234:5678::1')).toBe('2001:0db8:1234::/48');
    expect(ipBucket('2001:db8:1234:5678:aaaa::1')).toBe(ipBucket('2001:db8:1234:5678:bbbb::2'));
  });
});

describe('password policy and hashing', () => {
  const passwords = new PasswordService({ ...devConfig, argon2: { memoryCost: 19_456, timeCost: 2, parallelism: 1 } });

  it('hashes with Argon2id and flags weaker legacy parameters for rehash', async () => {
    const hash = await passwords.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await passwords.verify(hash, 'correct horse battery staple')).toEqual({ valid: true, needsRehash: false });
    expect((await passwords.verify(hash, 'wrong')).valid).toBe(false);
    const stronger = new PasswordService({ ...devConfig, argon2: { memoryCost: 65_536, timeCost: 3, parallelism: 4 } });
    expect((await stronger.verify(hash, 'correct horse battery staple')).needsRehash).toBe(true);
    expect((await passwords.verify('not-a-hash', 'x')).valid).toBe(false);
  });

  it('enforces length and screens common/personal passwords without composition rules', async () => {
    expect(await passwords.validate('short')).not.toHaveLength(0);
    expect(await passwords.validate('password1234')).not.toHaveLength(0);
    expect(await passwords.validate('Sommer2026!')).not.toHaveLength(0);
    expect(await passwords.validate('janedoe-loves-tea', { email: 'janedoe@octa.example' })).not.toHaveLength(0);
    expect(await passwords.validate('aaaaaaaaaaaaaa')).not.toHaveLength(0);
    expect(await passwords.validate('tangerine orbit lantern')).toHaveLength(0); // spaces, no symbols: fine
  });
});

describe('configuration validation', () => {
  it('accepts a complete production configuration', () => {
    const config = loadAuthConfig(prodEnv);
    expect(config.cookie.session).toBe('__Host-bms_session');
    expect(config.cookie.secure).toBe(true);
    expect(config.allowedOrigins).toEqual(['https://bms.example.invalid']);
  });

  it.each([
    ['missing key', { AUTH_ENCRYPTION_KEY: undefined }],
    ['short key', { AUTH_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }],
    ['http origin', { APP_PUBLIC_ORIGIN: 'http://bms.example.invalid' }],
    ['cookie without __Host-', { SESSION_COOKIE_NAME: 'bms_session' }],
    ['unset TRUST_PROXY', { TRUST_PROXY: undefined }],
    ['trust every proxy', { TRUST_PROXY: 'true' }],
    ['non-standard TOTP period', { MFA_TOTP_PERIOD_SECONDS: '60' }],
    ['8-digit TOTP', { MFA_TOTP_DIGITS: '8' }],
    ['invalid mode', { MFA_REQUIRED_MODE: 'sometimes' }],
    ['idle timeout out of range', { SESSION_IDLE_MINUTES: '0' }],
    ['reserved key id', { AUTH_ENCRYPTION_KEY_ID: 'dev-insecure' }],
  ])('refuses production start with %s', (_label, override) => {
    expect(() => loadAuthConfig({ ...prodEnv, ...override } as NodeJS.ProcessEnv)).toThrow(AuthConfigError);
  });

  it('derives the WebAuthn RP ID from the public origin and rejects IPs or foreign domains', () => {
    expect(loadAuthConfig(prodEnv).webauthn).toEqual({ rpId: 'bms.example.invalid', rpName: 'OCTA BMS', origins: ['https://bms.example.invalid'] });
    expect(loadAuthConfig({ ...prodEnv, WEBAUTHN_RP_ID: 'example.invalid' }).webauthn.rpId).toBe('example.invalid');
    expect(() => loadAuthConfig({ ...prodEnv, WEBAUTHN_RP_ID: 'evil.example' })).toThrow(AuthConfigError);
    expect(() => loadAuthConfig({ ...prodEnv, APP_PUBLIC_ORIGIN: 'https://10.0.0.5' })).toThrow(AuthConfigError);
    expect(devConfig.webauthn.rpId).toBe('localhost');
    expect(devConfig.webauthn.origins.every((o) => new URL(o).hostname === 'localhost')).toBe(true);
  });

  it('defaults: 60 min idle, 12 h absolute, optional MFA, 10 min step-up, ±1 step', () => {
    expect(devConfig.session).toMatchObject({ idleMinutes: 60, absoluteHours: 12 });
    expect(devConfig.mfa).toMatchObject({ defaultMode: 'OPTIONAL', stepUpMaxAgeMinutes: 10, window: 1, preAuthTtlSeconds: 300, periodSeconds: 30, digits: 6 });
    expect(devConfig.keys.insecureDevKey).toBe(true);
  });
});

describe('log/audit sanitization', () => {
  it('redacts every secret-bearing key at any depth', () => {
    const out = JSON.stringify(sanitizeContext({
      password: 'hunter2hunter2', code: '123456', recoveryCodes: ['AAAAA-BBBBB'], csrfToken: 'x', otpauthUri: 'otpauth://totp/x?secret=ABC',
      nested: { sessionToken: 'abc', manualKey: 'ABCD', qrSvg: '<svg>', fine: 'visible' },
    }));
    for (const secret of ['hunter2hunter2', '123456', 'AAAAA-BBBBB', 'otpauth://', 'secret=ABC', '<svg>', '"ABCD"']) expect(out).not.toContain(secret);
    expect(out).toContain('visible');
  });
});
