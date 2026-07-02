import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CacheEntry {
  permissions: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * Resolves a user's effective permission set for the active company.
 * Role assignments scoped to another company are excluded; global assignments
 * (companyId = null) always apply. In-memory cache, 60s TTL (swap for Redis
 * when running multiple replicas).
 */
@Injectable()
export class RbacService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async getPermissions(
    userId: string,
    companyId: string | null,
  ): Promise<Set<string>> {
    const key = `${userId}:${companyId ?? 'global'}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.permissions;

    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId,
        OR: [{ companyId: null }, { companyId: companyId ?? undefined }],
      },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
      },
    });

    const permissions = new Set<string>();
    for (const ur of userRoles) {
      if (ur.role.deletedAt) continue;
      for (const rp of ur.role.permissions) {
        permissions.add(rp.permission.code);
      }
    }

    this.cache.set(key, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
    return permissions;
  }

  invalidate(userId?: string) {
    if (!userId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
  }
}
