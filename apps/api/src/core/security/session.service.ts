import { Injectable } from '@nestjs/common';
import type { AuthSession, AuthSessionRevokeReason, Prisma, User } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, ipPrefix, randomToken } from './crypto';
import { SecurityPolicyService } from './security-policy.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CreateSessionInput {
  userId: string;
  mfa: boolean;
  method: 'password' | 'oidc';
  req?: Request;
  /** keep the original absolute expiry/authenticatedAt when rotating */
  from?: AuthSession;
  reauth?: boolean;
}

export type ValidSession = AuthSession & {
  user: Pick<User, 'id' | 'email' | 'isSystemAdmin' | 'isActive' | 'status' | 'deletedAt' | 'mfaRequired'>;
};

export function summarizeUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return `${browser} on ${os}`;
}

/**
 * Server-side opaque sessions. The cookie carries 256 random bits; the database stores
 * only SHA-256 of it. Every request re-reads the row, so revocation is immediate on all
 * API instances. Idle expiry slides with activity but never past the absolute expiry.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SecurityPolicyService,
  ) {}

  hash(token: string): string {
    return hashToken('session', token);
  }

  async create(input: CreateSessionInput, db: Db = this.prisma): Promise<{ token: string; session: AuthSession }> {
    const policy = await this.policy.get();
    const now = new Date();
    const token = randomToken(32);
    const absoluteExpiresAt = input.from?.absoluteExpiresAt ?? new Date(now.getTime() + policy.sessionAbsoluteHours * 3_600_000);
    const idleExpiresAt = new Date(Math.min(now.getTime() + policy.sessionIdleMinutes * 60_000, absoluteExpiresAt.getTime()));
    const session = await db.authSession.create({
      data: {
        userId: input.userId,
        tokenHash: this.hash(token),
        csrfToken: randomToken(32),
        idleExpiresAt,
        absoluteExpiresAt,
        authenticatedAt: input.from?.authenticatedAt ?? now,
        lastMfaAt: input.mfa ? now : (input.from?.lastMfaAt ?? null),
        lastReauthAt: input.reauth || !input.from ? now : input.from.lastReauthAt,
        authMethod: input.from?.authMethod ?? input.method,
        userAgent: input.req ? summarizeUserAgent(input.req.header('user-agent')) : input.from?.userAgent ?? null,
        ipPrefix: input.req ? ipPrefix(input.req.ip) : input.from?.ipPrefix ?? null,
        rotatedFromId: input.from?.id ?? null,
      },
    });
    return { token, session };
  }

  /** Resolves a cookie value to a live session or null (never throws for bad input). */
  async validate(token: string | undefined, now = new Date()): Promise<ValidSession | null> {
    if (!token || token.length > 128) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: { select: { id: true, email: true, isSystemAdmin: true, isActive: true, status: true, deletedAt: true, mfaRequired: true } } },
    });
    if (!session || session.revokedAt) return null;
    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
    const user = session.user;
    if (!user.isActive || user.deletedAt || user.status !== 'ACTIVE') {
      await this.revoke(session.id, 'ACCOUNT_DISABLED');
      return null;
    }
    if (now.getTime() - session.lastActivityAt.getTime() > 60_000) {
      const policy = await this.policy.get();
      const idleExpiresAt = new Date(Math.min(now.getTime() + policy.sessionIdleMinutes * 60_000, session.absoluteExpiresAt.getTime()));
      await this.prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastActivityAt: now, idleExpiresAt } });
      session.lastActivityAt = now;
      session.idleExpiresAt = idleExpiresAt;
    }
    return session;
  }

  /** Issues a fresh identifier for the same login (fixation defence); old token stops working. */
  async rotate(from: AuthSession, opts: { mfa?: boolean; reauth?: boolean; req?: Request } = {}): Promise<{ token: string; session: AuthSession }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.authSession.updateMany({ where: { id: from.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ROTATED' } });
      if (count !== 1) throw new Error('session already revoked');
      return this.create({ userId: from.userId, mfa: !!opts.mfa, method: from.authMethod as 'password' | 'oidc', from, reauth: opts.reauth, req: opts.req }, tx);
    });
  }

  async revoke(sessionId: string, reason: AuthSessionRevokeReason, db: Db = this.prisma): Promise<boolean> {
    const { count } = await db.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    return count === 1;
  }

  async revokeAllForUser(userId: string, reason: AuthSessionRevokeReason, exceptSessionId?: string, db: Db = this.prisma): Promise<number> {
    const { count } = await db.authSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return count;
  }

  list(userId: string) {
    const now = new Date();
    return this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      select: { id: true, issuedAt: true, lastActivityAt: true, idleExpiresAt: true, absoluteExpiresAt: true, authMethod: true, lastMfaAt: true, userAgent: true, ipPrefix: true },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  async purgeExpired(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const { count } = await this.prisma.authSession.deleteMany({ where: { absoluteExpiresAt: { lt: cutoff } } });
    return count;
  }
}
