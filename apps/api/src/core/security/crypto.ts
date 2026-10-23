import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import { DEV_KEY_ID, type AuthConfig, type EncryptionKey } from './auth-config';

/** 256-bit CSPRNG token, base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Domain-separated SHA-256 for high-entropy tokens (sessions, resets, invites). */
export function hashToken(purpose: string, token: string): string {
  return createHash('sha256').update(`octa-bms:${purpose}:v1:`).update(token).digest('hex');
}

/** SHA-256 of an identifier (e.g. email) for rate-limit keys and logs — not reversible in logs. */
export function hashIdentifier(value: string): string {
  return createHash('sha256').update('octa-bms:identifier:v1:').update(value).digest('hex').slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 symbols, no 0/O/1/I

/** 10 symbols × 5 bits = 50 bits, shown as XXXXX-XXXXX. */
export function randomRecoveryCode(): string {
  let out = '';
  for (let i = 0; i < 10; i++) out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== 10) return null;
  for (const ch of cleaned) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return cleaned;
}

export class DecryptionError extends Error {}

/**
 * AES-256-GCM envelope with a key ring. Format: `v1.<keyId>.<iv>.<ciphertext+tag>`
 * (base64url parts). Associated data binds a ciphertext to its owner/record, so a seed
 * copied to another user's row fails authentication.
 */
export class KeyRing {
  private readonly keys = new Map<string, EncryptionKey>();

  constructor(private readonly config: AuthConfig['keys'], private readonly production: boolean) {
    for (const key of [config.current, ...config.previous]) this.keys.set(key.id, key);
  }

  get currentKeyId(): string {
    return this.config.current.id;
  }

  encrypt(plaintext: string, aad: string): { ciphertext: string; keyId: string } {
    const { id, key } = this.config.current;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext: `v1.${id}.${iv.toString('base64url')}.${body.toString('base64url')}`, keyId: id };
  }

  decrypt(envelope: string, aad: string): string {
    const [version, keyId, ivPart, bodyPart] = envelope.split('.');
    if (version !== 'v1' || !keyId || !ivPart || !bodyPart) throw new DecryptionError('Malformed ciphertext');
    if (this.production && keyId === DEV_KEY_ID) throw new DecryptionError('Development key refused in production');
    const key = this.keys.get(keyId);
    if (!key) throw new DecryptionError(`Unknown key id ${keyId}`);
    const body = Buffer.from(bodyPart, 'base64url');
    if (body.length < 17) throw new DecryptionError('Malformed ciphertext');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(ivPart, 'base64url'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(body.subarray(body.length - 16));
      return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
    } catch {
      throw new DecryptionError('Ciphertext authentication failed');
    }
  }

  needsReencryption(envelope: string): boolean {
    return envelope.split('.')[1] !== this.config.current.id;
  }

  /** HKDF-derived pepper for recovery-code HMACs, versioned with the key id. */
  pepper(keyId = this.config.current.id): Buffer {
    if (this.production && keyId === DEV_KEY_ID) throw new DecryptionError('Development key refused in production');
    const key = this.keys.get(keyId);
    if (!key) throw new DecryptionError(`Unknown key id ${keyId}`);
    return Buffer.from(hkdfSync('sha256', key.key, 'octa-bms', 'recovery-code-pepper:v1', 32));
  }

  hmac(keyId: string, value: string): string {
    return createHmac('sha256', this.pepper(keyId)).update(value).digest('hex');
  }
}

/** Coarse network context for storage: IPv4 /24, IPv6 /48. */
export function ipPrefix(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (ip.includes(':')) return `${expandV6(ip).slice(0, 3).join(':')}::/48`;
  return null;
}

/** Rate-limit bucket for an address: IPv4 exact, IPv6 /64 (defeats per-address rotation). */
export function ipBucket(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4;
  if (ip.includes(':')) return `${expandV6(ip).slice(0, 4).join(':')}::/64`;
  return ip;
}

function expandV6(ip: string): string[] {
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((part) => part.padStart(4, '0').toLowerCase());
}
