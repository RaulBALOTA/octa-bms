import { Inject, Injectable } from '@nestjs/common';
import type { MfaChallenge, MfaChallengePurpose, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { hashToken, ipPrefix, randomToken } from './crypto';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Pre-authentication transactions: created only after the password (or OIDC) step
 * succeeds, held in a separate cookie, valid for a handful of endpoints, short TTL,
 * bounded attempts, single use. A challenge can never be used as a session.
 */
@Injectable()
export class MfaChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  hash(token: string): string {
    return hashToken('preauth', token);
  }

  async create(userId: string, purpose: MfaChallengePurpose, method: 'password' | 'oidc', req?: Request): Promise<{ token: string; challenge: MfaChallenge }> {
    const token = randomToken(32);
    const ttl = purpose === 'ENROLL' ? this.config.mfa.enrollTtlSeconds : this.config.mfa.preAuthTtlSeconds;
    // one live challenge per user: older pending ones are invalidated
    await this.prisma.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    const challenge = await this.prisma.mfaChallenge.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        csrfToken: randomToken(32),
        purpose,
        authMethod: method,
        expiresAt: new Date(Date.now() + ttl * 1000),
        maxAttempts: this.config.mfa.maxChallengeAttempts,
        ipPrefix: ipPrefix(req?.ip),
      },
    });
    return { token, challenge };
  }

  async load(token: string | undefined, now = new Date()): Promise<MfaChallenge | null> {
    if (!token || token.length > 128) return null;
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { tokenHash: this.hash(token) } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= challenge.maxAttempts) return null;
    return challenge;
  }

  /** Atomically reserves one attempt; false when the challenge is exhausted/consumed/expired. */
  async reserveAttempt(id: string): Promise<boolean> {
    // single UPDATE … WHERE attempts < maxAttempts (field reference) → atomic under concurrency
    const { count } = await this.prisma.mfaChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: this.prisma.mfaChallenge.fields.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  /** Single-use consumption; only one concurrent caller can succeed. */
  async consume(id: string, db: Db = this.prisma): Promise<boolean> {
    const { count } = await db.mfaChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    return count === 1;
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.mfaChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
    return count;
  }
}
