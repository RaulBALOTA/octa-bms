import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ipPrefix } from './crypto';

export interface SecurityEventInput {
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actorUserId?: string | null;
  targetUserId?: string | null;
  companyId?: string | null;
  context?: Record<string, unknown>;
  req?: Request;
}

const SECRET_KEY = /pass|secret|token|code|otp|seed|cookie|authorization|csrf|uri|qr|key|recovery/i;

/** Drops any key that could carry a credential; truncates strings; bounded depth. */
export function sanitizeContext(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[depth]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeContext(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitizeContext(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

export function requestMeta(req?: Request) {
  if (!req) return { ipPrefix: null, userAgent: null, correlationId: null };
  const id = (req as Request & { id?: unknown }).id;
  return {
    ipPrefix: ipPrefix(req.ip),
    userAgent: (req.header('user-agent') ?? '').slice(0, 160) || null,
    correlationId: typeof id === 'string' || typeof id === 'number' ? String(id) : (req.header('x-request-id') ?? null),
  };
}

/** Append-only security trail (no update/delete API exists for it). Never throws. */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger('SecurityAudit');

  constructor(private readonly prisma: PrismaService) {}

  async record(event: SecurityEventInput): Promise<void> {
    const meta = requestMeta(event.req);
    try {
      await this.prisma.securityEvent.create({
        data: {
          action: event.action,
          outcome: event.outcome,
          actorUserId: event.actorUserId ?? null,
          targetUserId: event.targetUserId ?? null,
          companyId: event.companyId ?? null,
          correlationId: meta.correlationId,
          ipPrefix: meta.ipPrefix,
          userAgent: meta.userAgent,
          context: event.context ? (sanitizeContext(event.context) as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (error) {
      this.logger.error(`security event write failed: ${event.action} (${error instanceof Error ? error.name : 'error'})`);
    }
  }

  async purgeOlderThan(days: number): Promise<number> {
    const { count } = await this.prisma.securityEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
    return count;
  }
}
