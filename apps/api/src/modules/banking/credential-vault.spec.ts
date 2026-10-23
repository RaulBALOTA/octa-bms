import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialVault } from './credential-vault';

describe('CredentialVault', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips credentials without storing them in clear text', () => {
    const vault = new CredentialVault(key);
    const sealed = vault.seal({ login: 'octa-gmbh', secretKey: 'top-secret' });
    expect(sealed).not.toContain('top-secret');
    expect(vault.open(sealed)).toEqual({ login: 'octa-gmbh', secretKey: 'top-secret' });
  });

  it('rejects tampered ciphertext and a different key', () => {
    const sealed = new CredentialVault(key).seal({ secretKey: 'x' });
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => new CredentialVault(key).open(parts.join('.'))).toThrow();
    expect(() => new CredentialVault(randomBytes(32).toString('base64')).open(sealed)).toThrow();
  });

  it('is not ready without a 32-byte key', () => {
    expect(new CredentialVault(undefined).ready).toBe(false);
    expect(new CredentialVault(randomBytes(16).toString('base64')).ready).toBe(false);
    expect(() => new CredentialVault(undefined).seal({})).toThrow(/BANKING_ENCRYPTION_KEY/);
  });
});
