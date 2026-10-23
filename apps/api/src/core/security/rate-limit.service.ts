import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { hashIdentifier } from './crypto';

export interface RateLimitRule {
  /** bucket name, e.g. "login:ip" */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/** Budgets for authentication flows. Account keys are hashed, never raw emails. */
export const RATE_LIMITS = {
  loginIp: { name: 'login:ip', limit: 30, windowSeconds: 300 },
  loginAccountFailures: { name: 'login:acct-fail', limit: 10, windowSeconds: 900 },
  loginIpAccountFailures: { name: 'login:ip-acct-fail', limit: 5, windowSeconds: 300 },
  mfaUserFailures: { name: 'mfa:user-fail', limit: 10, windowSeconds: 900 },
  mfaIp: { name: 'mfa:ip', limit: 60, windowSeconds: 900 },
  recoveryUserFailures: { name: 'recovery:user-fail', limit: 5, windowSeconds: 900 },
  enrollUserFailures: { name: 'enroll:user-fail', limit: 10, windowSeconds: 900 },
  stepUpUserFailures: { name: 'stepup:user-fail', limit: 5, windowSeconds: 900 },
  forgotIp: { name: 'forgot:ip', limit: 10, windowSeconds: 3600 },
  forgotAccount: { name: 'forgot:acct', limit: 3, windowSeconds: 3600 },
  tokenIp: { name: 'token:ip', limit: 20, windowSeconds: 3600 },
  invitationsActor: { name: 'invite:actor', limit: 50, windowSeconds: 3600 },
  adminActor: { name: 'admin:actor', limit: 120, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counters in PostgreSQL. A single `INSERT … ON CONFLICT DO UPDATE …
 * RETURNING` is atomic, so limits hold across every API instance sharing the database
 * (no per-process memory). Expired windows are purged by the maintenance job.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  private key(rule: RateLimitRule, subject: string): string {
    return `${rule.name}:${hashIdentifier(subject)}`;
  }

  private window(rule: RateLimitRule, now: number) {
    const start = Math.floor(now / (rule.windowSeconds * 1000)) * rule.windowSeconds * 1000;
    return { start: new Date(start), end: new Date(start + rule.windowSeconds * 1000) };
  }

  /** Increments and returns whether the request is within budget. */
  async hit(rule: RateLimitRule, subject: string, now = Date.now()): Promise<RateLimitResult> {
    const { start, end } = this.window(rule, now);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "auth_rate_limits" ("key", "windowStart", "count", "expiresAt")
      VALUES (${this.key(rule, subject)}, (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC'), 1, (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "auth_rate_limits"."count" + 1
      RETURNING "count"`;
    const count = Number(rows[0]?.count ?? 0);
    return { allowed: count <= rule.limit, count, retryAfterSeconds: Math.ceil((end.getTime() - now) / 1000) };
  }

  /** Reads the current window without incrementing. */
  async peek(rule: RateLimitRule, subject: string, now = Date.now()): Promise<RateLimitResult> {
    const { start, end } = this.window(rule, now);
    const row = await this.prisma.authRateLimit.findUnique({
      where: { key_windowStart: { key: this.key(rule, subject), windowStart: start } },
    });
    const count = row?.count ?? 0;
    return { allowed: count < rule.limit, count, retryAfterSeconds: Math.ceil((end.getTime() - now) / 1000) };
  }

  async assertHit(rule: RateLimitRule, subject: string): Promise<void> {
    const result = await this.hit(rule, subject);
    if (!result.allowed) throw new AuthError('TOO_MANY_ATTEMPTS', undefined, { retryAfterSeconds: result.retryAfterSeconds });
  }

  async assertBelow(rule: RateLimitRule, subject: string): Promise<void> {
    const result = await this.peek(rule, subject);
    if (!result.allowed) throw new AuthError('TOO_MANY_ATTEMPTS', undefined, { retryAfterSeconds: result.retryAfterSeconds });
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.authRateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  }
}
