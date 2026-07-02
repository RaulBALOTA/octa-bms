import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  companyId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        companyId: entry.companyId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  /** Field-level diff of two plain objects (ignores audit columns). */
  diff(
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Record<string, { old: unknown; new: unknown }> {
    const ignored = new Set(['updatedAt', 'createdAt', 'passwordHash']);
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const keys = new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after),
    ]);
    for (const key of keys) {
      if (ignored.has(key)) continue;
      const oldVal = before?.[key];
      const newVal = after[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes[key] = { old: oldVal ?? null, new: newVal ?? null };
      }
    }
    return changes;
  }
}
