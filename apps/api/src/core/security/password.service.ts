import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { COMMON_PASSWORDS } from './common-passwords';

export interface PasswordContext {
  email?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Argon2id hashing (parameters from config, verified at startup) plus a password
 * policy following NIST SP 800-63B: length-based, no composition rules, screened
 * against common/breached passwords. Paste and password managers are allowed.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private dummyHash: Promise<string> | null = null;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  private get options(): argon2.Options & { raw?: false } {
    return { type: argon2.argon2id, ...this.config.argon2 };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  /** Verifies and reports whether the stored hash should be upgraded to current parameters. */
  async verify(hash: string, password: string): Promise<{ valid: boolean; needsRehash: boolean }> {
    try {
      const valid = await argon2.verify(hash, password);
      return { valid, needsRehash: valid && argon2.needsRehash(hash, this.options) };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  /** Burns comparable CPU when the account does not exist (uniform timing). */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('octa-bms-dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  /** Returns policy violations (empty = acceptable). */
  async validate(password: string, context: PasswordContext = {}): Promise<string[]> {
    const issues: string[] = [];
    if (password.length < this.config.passwordMinLength) issues.push(`Use at least ${this.config.passwordMinLength} characters`);
    if (password.length > 256) issues.push('Use at most 256 characters');
    const lower = password.toLowerCase();
    const normalized = lower.replace(/[^a-z0-9]/g, '');
    if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(normalized) || /^(.)\1+$/.test(password)) {
      issues.push('This password is too common');
    }
    const local = context.email?.split('@')[0]?.toLowerCase();
    const parts = [local, context.firstName?.toLowerCase(), context.lastName?.toLowerCase()].filter((p): p is string => !!p && p.length >= 4);
    if (parts.some((part) => lower.includes(part))) issues.push('Do not include your name or email address');
    if (lower.includes('octa') && normalized.replace(/octa|bms|\d/g, '').length < 6) issues.push('This password is too easy to guess');
    if (!issues.length && this.config.hibpEnabled && (await this.isBreached(password))) {
      issues.push('This password appeared in a known data breach');
    }
    return issues;
  }

  /**
   * Have I Been Pwned range API (k-anonymity): only the first 5 hex chars of the SHA-1
   * leave the server; the password itself never does. Fails open on network errors.
   */
  private async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const suffix = sha1.slice(5);
      return (await response.text()).split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':');
        return hashSuffix === suffix && Number(count) > 0;
      });
    } catch {
      this.logger.warn('Breached-password check unavailable');
      return false;
    }
  }

  /** Startup self-test: hashes once to validate parameters and reports duration. */
  async benchmark(): Promise<number> {
    const started = Date.now();
    await this.hash('benchmark-only-not-a-secret');
    return Date.now() - started;
  }
}
