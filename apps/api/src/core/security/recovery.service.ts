import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { KEY_RING } from './tokens';
import { KeyRing, normalizeRecoveryCode, randomRecoveryCode, safeEqual } from './crypto';

type Db = PrismaService | Prisma.TransactionClient;

export const RECOVERY_CODE_COUNT = 10;

/**
 * Ten single-use backup codes per user. Stored as HMAC-SHA256 under an HKDF pepper
 * derived from the encryption key (outside the DB), bound to the user id. Plaintext is
 * returned exactly once, at generation.
 */
@Injectable()
export class RecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(KEY_RING) private readonly keys: KeyRing,
  ) {}

  private digest(keyId: string, userId: string, normalized: string): string {
    return this.keys.hmac(keyId, `recovery:${userId}:${normalized}`);
  }

  /** Revokes every outstanding code and creates a new batch. Run inside the caller's transaction. */
  async generate(userId: string, db: Db = this.prisma): Promise<string[]> {
    await db.recoveryCode.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const batchId = randomUUID();
    const keyId = this.keys.currentKeyId;
    const codes = new Set<string>();
    while (codes.size < RECOVERY_CODE_COUNT) codes.add(randomRecoveryCode());
    await db.recoveryCode.createMany({
      data: [...codes].map((code) => ({
        userId,
        batchId,
        pepperKeyId: keyId,
        codeHash: this.digest(keyId, userId, normalizeRecoveryCode(code)!),
      })),
    });
    return [...codes];
  }

  /** Atomically marks one matching code used. Exactly one concurrent caller can win. */
  async redeem(userId: string, input: string, db: Db = this.prisma): Promise<boolean> {
    const normalized = normalizeRecoveryCode(input);
    const candidates = await db.recoveryCode.findMany({ where: { userId, usedAt: null, revokedAt: null }, select: { id: true, codeHash: true, pepperKeyId: true } });
    if (!normalized) return false;
    let matchId: string | null = null;
    for (const row of candidates) {
      let expected: string;
      try {
        expected = this.digest(row.pepperKeyId, userId, normalized);
      } catch {
        continue; // retired key: code can no longer be verified
      }
      if (safeEqual(expected, row.codeHash) && !matchId) matchId = row.id;
    }
    if (!matchId) return false;
    const { count } = await db.recoveryCode.updateMany({ where: { id: matchId, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }

  remaining(userId: string, db: Db = this.prisma): Promise<number> {
    return db.recoveryCode.count({ where: { userId, usedAt: null, revokedAt: null } });
  }

  async revokeAll(userId: string, db: Db = this.prisma): Promise<void> {
    await db.recoveryCode.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
