import { Inject, Injectable } from '@nestjs/common';
import type { MfaAuthenticator, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { AuthError } from './auth-errors';
import { KeyRing } from './crypto';
import { RecoveryService } from './recovery.service';
import { KEY_RING } from './tokens';
import { TotpService } from './totp.service';

type Db = PrismaService | Prisma.TransactionClient;

const MAX_ENROLL_ATTEMPTS = 5;

export interface EnrollmentStart {
  enrollmentId: string;
  qrSvg: string;
  manualKey: string;
  issuer: string;
  accountName: string;
  algorithm: 'SHA1';
  digits: 6;
  period: 30;
  expiresAt: Date;
}

const seedAad = (userId: string, authenticatorId: string) => `mfa-totp:${userId}:${authenticatorId}`;
const enrollmentAad = (userId: string, enrollmentId: string) => `mfa-enrollment:${userId}:${enrollmentId}`;

/** TOTP factor lifecycle: enrollment, confirmation, verification with replay protection. */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
    private readonly recovery: RecoveryService,
    @Inject(KEY_RING) private readonly keys: KeyRing,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  activeAuthenticator(userId: string, db: Db = this.prisma): Promise<MfaAuthenticator | null> {
    return db.mfaAuthenticator.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { confirmedAt: 'desc' } });
  }

  async status(userId: string) {
    const [authenticator, remaining, pending] = await Promise.all([
      this.activeAuthenticator(userId),
      this.recovery.remaining(userId),
      this.prisma.mfaEnrollment.count({ where: { userId, consumedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return {
      enrolled: !!authenticator,
      type: authenticator?.type ?? null,
      label: authenticator?.label ?? null,
      enrolledAt: authenticator?.confirmedAt ?? null,
      lastUsedAt: authenticator?.lastUsedAt ?? null,
      recoveryCodesRemaining: authenticator ? remaining : 0,
      pendingEnrollment: pending > 0,
    };
  }

  /** Creates a pending enrollment. QR and manual key are returned only here. */
  async startEnrollment(user: { id: string; email: string }): Promise<EnrollmentStart> {
    await this.prisma.mfaEnrollment.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
    const secret = this.totp.generateSecret();
    const id = randomUUID();
    const { ciphertext, keyId } = this.keys.encrypt(secret, enrollmentAad(user.id, id));
    const expiresAt = new Date(Date.now() + this.config.mfa.enrollTtlSeconds * 1000);
    await this.prisma.mfaEnrollment.create({ data: { id, userId: user.id, encryptedSeed: ciphertext, seedKeyId: keyId, expiresAt } });
    const uri = this.totp.provisioningUri(secret, user.email);
    return {
      enrollmentId: id,
      qrSvg: await this.totp.qrSvg(uri),
      manualKey: this.totp.formatManualKey(secret),
      issuer: this.config.mfa.issuer,
      accountName: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      expiresAt,
    };
  }

  /**
   * Activates the pending seed after one valid code. Replaces any existing factor
   * (re-enrollment) and issues a fresh recovery-code batch — returned once.
   */
  async confirmEnrollment(userId: string, enrollmentId: string, code: string): Promise<{ authenticatorId: string; recoveryCodes: string[] }> {
    const { count } = await this.prisma.mfaEnrollment.updateMany({
      where: { id: enrollmentId, userId, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ENROLL_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count !== 1) throw new AuthError('MFA_ENROLLMENT_INVALID', 'This setup has expired. Start again.');
    const enrollment = await this.prisma.mfaEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    const secret = this.keys.decrypt(enrollment.encryptedSeed, enrollmentAad(userId, enrollment.id));
    const step = this.totp.match(secret, code);
    if (step === null) throw new AuthError('MFA_CODE_INVALID');

    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.mfaEnrollment.updateMany({ where: { id: enrollmentId, consumedAt: null }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new AuthError('MFA_ENROLLMENT_INVALID', 'This setup has expired. Start again.');
      await tx.mfaAuthenticator.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      const authenticatorId = randomUUID();
      const sealed = this.keys.encrypt(secret, seedAad(userId, authenticatorId));
      const now = new Date();
      await tx.mfaAuthenticator.create({
        data: { id: authenticatorId, userId, encryptedSeed: sealed.ciphertext, seedKeyId: sealed.keyId, confirmedAt: now, lastUsedStep: BigInt(step), lastUsedAt: now },
      });
      await tx.user.update({ where: { id: userId }, data: { mfaEnrolledAt: now, mfaEnabled: true } });
      const recoveryCodes = await this.recovery.generate(userId, tx);
      return { authenticatorId, recoveryCodes };
    });
  }

  /**
   * Verifies a TOTP code for the user's active factor. The accepted counter is stored
   * with a conditional update (`lastUsedStep < step`), so a code — or an older code —
   * can be accepted at most once even under parallel requests.
   */
  async verify(userId: string, code: string, db: Db = this.prisma): Promise<boolean> {
    const authenticator = await this.activeAuthenticator(userId, db);
    if (!authenticator) return false;
    const secret = this.keys.decrypt(authenticator.encryptedSeed, seedAad(userId, authenticator.id));
    const step = this.totp.match(secret, code, authenticator.lastUsedStep);
    if (step === null) return false;
    const rotate = this.keys.needsReencryption(authenticator.encryptedSeed);
    const sealed = rotate ? this.keys.encrypt(secret, seedAad(userId, authenticator.id)) : null;
    const { count } = await db.mfaAuthenticator.updateMany({
      where: { id: authenticator.id, status: 'ACTIVE', lastUsedStep: { lt: BigInt(step) } },
      data: { lastUsedStep: BigInt(step), lastUsedAt: new Date(), ...(sealed ? { encryptedSeed: sealed.ciphertext, seedKeyId: sealed.keyId } : {}) },
    });
    return count === 1;
  }

  /** Removes all factors and recovery codes (disable, admin recovery). */
  async removeAll(userId: string, db: Db = this.prisma): Promise<number> {
    const { count } = await db.mfaAuthenticator.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    await this.recovery.revokeAll(userId, db);
    await db.mfaEnrollment.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    await db.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaEnrolledAt: null } });
    return count;
  }

  async purgeExpiredEnrollments(): Promise<number> {
    const { count } = await this.prisma.mfaEnrollment.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
    return count;
  }
}
