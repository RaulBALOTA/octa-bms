import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ConnectionCredentials } from './banking.types';

const VERSION = 'v1';

/**
 * AES-256-GCM sealing for bank credentials at rest. The key comes from
 * BANKING_ENCRYPTION_KEY (32 bytes, base64 — `openssl rand -base64 32`).
 * Format: v1.<iv>.<tag>.<ciphertext>, all base64url.
 */
export class CredentialVault {
  private readonly key: Buffer | null;

  constructor(rawKey: string | undefined) {
    const key = rawKey ? Buffer.from(rawKey, 'base64') : null;
    this.key = key?.length === 32 ? key : null;
  }

  get ready() {
    return this.key !== null;
  }

  seal(credentials: ConnectionCredentials): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    ).join('.');
  }

  open(sealed: string): ConnectionCredentials {
    const key = this.requireKey();
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !data) throw new Error('Unreadable bank credentials');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as ConnectionCredentials;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('BANKING_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    return this.key;
  }
}
