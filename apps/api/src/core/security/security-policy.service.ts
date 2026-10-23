import { Inject, Injectable } from '@nestjs/common';
import type { MfaPolicyMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { AuthError } from './auth-errors';
import { SecurityAuditService } from './security-audit.service';

export interface EffectivePolicy {
  mfaMode: MfaPolicyMode;
  enrollmentDeadline: Date | null;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  stepUpMaxAgeMinutes: number;
  passkeysEnabled: boolean;
  requirePasskeyForAdmins: boolean;
  source: 'database' | 'environment';
}

export interface PolicyUpdate {
  mfaMode?: MfaPolicyMode;
  enrollmentDeadline?: Date | null;
  sessionIdleMinutes?: number | null;
  sessionAbsoluteHours?: number | null;
  stepUpMaxAgeMinutes?: number | null;
  passkeysEnabled?: boolean;
  requirePasskeyForAdmins?: boolean;
}

export interface MfaRequirement {
  /** user has an active factor → second factor must be verified at sign-in */
  challenge: boolean;
  /** no factor and policy requires one → enrollment before any session */
  enroll: boolean;
  /** policy requires a factor later; full access until the deadline */
  enrollmentDue: Date | null;
  /** MFA is required for this user (now or after the deadline) */
  required: boolean;
}

const CACHE_MS = 15_000;

@Injectable()
export class SecurityPolicyService {
  private cache: { value: EffectivePolicy; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly audit: SecurityAuditService,
  ) {}

  async get(fresh = false): Promise<EffectivePolicy> {
    if (!fresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.securityPolicy.findUnique({ where: { id: 'global' } });
    const value: EffectivePolicy = {
      mfaMode: row?.mfaMode ?? this.config.mfa.defaultMode,
      enrollmentDeadline: row?.enrollmentDeadline ?? null,
      sessionIdleMinutes: row?.sessionIdleMinutes ?? this.config.session.idleMinutes,
      sessionAbsoluteHours: row?.sessionAbsoluteHours ?? this.config.session.absoluteHours,
      stepUpMaxAgeMinutes: row?.stepUpMaxAgeMinutes ?? this.config.mfa.stepUpMaxAgeMinutes,
      passkeysEnabled: row?.passkeysEnabled ?? true,
      requirePasskeyForAdmins: row?.requirePasskeyForAdmins ?? false,
      source: row ? 'database' : 'environment',
    };
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  requirementFor(policy: EffectivePolicy, user: { mfaRequired: boolean }, hasActiveFactor: boolean, now = new Date()): MfaRequirement {
    if (hasActiveFactor) return { challenge: true, enroll: false, enrollmentDue: null, required: true };
    if (user.mfaRequired) return { challenge: false, enroll: true, enrollmentDue: null, required: true };
    switch (policy.mfaMode) {
      case 'DISABLED':
      case 'OPTIONAL':
        return { challenge: false, enroll: false, enrollmentDue: null, required: false };
      case 'ENROLLMENT_REQUIRED':
        if (policy.enrollmentDeadline && policy.enrollmentDeadline > now) {
          return { challenge: false, enroll: false, enrollmentDue: policy.enrollmentDeadline, required: true };
        }
        return { challenge: false, enroll: true, enrollmentDue: null, required: true };
      case 'ENFORCED':
        return { challenge: false, enroll: true, enrollmentDue: null, required: true };
    }
  }

  /** Active second factors of a user: TOTP authenticator and passkeys. */
  async factors(userId: string): Promise<{ totp: boolean; passkeys: number }> {
    const [totp, passkeys] = await Promise.all([
      this.prisma.mfaAuthenticator.count({ where: { userId, status: 'ACTIVE' } }),
      this.prisma.webAuthnCredential.count({ where: { userId, revokedAt: null } }),
    ]);
    return { totp: totp > 0, passkeys };
  }

  async requirement(userId: string, user: { mfaRequired: boolean }): Promise<MfaRequirement> {
    const [policy, factors] = await Promise.all([this.get(), this.factors(userId)]);
    return this.requirementFor(policy, user, factors.totp || factors.passkeys > 0);
  }

  /**
   * Second-factor methods this user may use right now. With "require passkeys for
   * administrators", a system administrator who has a passkey can no longer use TOTP.
   * Recovery codes remain available as the lost-device path.
   */
  async methodsFor(userId: string): Promise<{ totp: boolean; passkey: boolean; passkeyRequired: boolean }> {
    const [policy, factors, user] = await Promise.all([
      this.get(),
      this.factors(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } }),
    ]);
    const passkey = policy.passkeysEnabled && factors.passkeys > 0;
    const passkeyRequired = passkey && policy.requirePasskeyForAdmins && !!user?.isSystemAdmin;
    return { totp: factors.totp && !passkeyRequired, passkey, passkeyRequired };
  }

  /** Admins with an active factor; enforcement needs at least two (recoverability). */
  async enrolledAdminCount(): Promise<number> {
    return this.prisma.user.count({
      where: {
        isSystemAdmin: true, isActive: true, deletedAt: null,
        OR: [{ mfaAuthenticators: { some: { status: 'ACTIVE' } } }, { webauthnCredentials: { some: { revokedAt: null } } }],
      },
    });
  }

  async adminPasskeyCoverage(): Promise<{ admins: number; withPasskey: number }> {
    const where = { isSystemAdmin: true, isActive: true, deletedAt: null };
    const [admins, withPasskey] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { ...where, webauthnCredentials: { some: { revokedAt: null } } } }),
    ]);
    return { admins, withPasskey };
  }

  async update(
    actor: { id: string; isSystemAdmin: boolean },
    input: PolicyUpdate,
    req?: Parameters<SecurityAuditService['record']>[0]['req'],
  ): Promise<EffectivePolicy> {
    if (!actor.isSystemAdmin) throw new AuthError('FORBIDDEN');
    const current = await this.get(true);
    const next = input.mfaMode ?? current.mfaMode;
    const actorFactors = await this.factors(actor.id);
    if (next === 'ENROLLMENT_REQUIRED' || next === 'ENFORCED') {
      if (!actorFactors.totp && !actorFactors.passkeys) throw new AuthError('POLICY_CHANGE_REJECTED', 'Register your own authenticator before requiring MFA for others');
    }
    if (next === 'ENFORCED') {
      const admins = await this.enrolledAdminCount();
      if (admins < 2) {
        throw new AuthError('POLICY_CHANGE_REJECTED', 'Enforcement requires at least two system administrators with an active authenticator and saved recovery codes', { enrolledAdmins: admins });
      }
    }
    const passkeysEnabled = input.passkeysEnabled ?? current.passkeysEnabled;
    const requirePasskeyForAdmins = input.requirePasskeyForAdmins ?? current.requirePasskeyForAdmins;
    if (requirePasskeyForAdmins && !passkeysEnabled) throw new AuthError('POLICY_CHANGE_REJECTED', 'Passkeys must be enabled to require them for administrators');
    if (requirePasskeyForAdmins && !current.requirePasskeyForAdmins) {
      // lock-out guard: every active system administrator must already have a passkey
      const coverage = await this.adminPasskeyCoverage();
      if (!actorFactors.passkeys) throw new AuthError('POLICY_CHANGE_REJECTED', 'Register your own passkey first');
      if (coverage.withPasskey < coverage.admins || coverage.withPasskey < 2) {
        throw new AuthError('POLICY_CHANGE_REJECTED', 'Every system administrator (at least two) must register a passkey before passkeys can be required', coverage);
      }
    }
    if (input.sessionIdleMinutes != null && (input.sessionIdleMinutes < 5 || input.sessionIdleMinutes > 1440)) throw new AuthError('POLICY_CHANGE_REJECTED', 'Idle timeout must be 5–1440 minutes');
    if (input.sessionAbsoluteHours != null && (input.sessionAbsoluteHours < 1 || input.sessionAbsoluteHours > 336)) throw new AuthError('POLICY_CHANGE_REJECTED', 'Absolute lifetime must be 1–336 hours');
    if (input.stepUpMaxAgeMinutes != null && (input.stepUpMaxAgeMinutes < 1 || input.stepUpMaxAgeMinutes > 60)) throw new AuthError('POLICY_CHANGE_REJECTED', 'Re-verification window must be 1–60 minutes');
    const keep = <T>(value: T | null | undefined, currentValue: T): T | null => (value === undefined ? (current.source === 'database' ? currentValue : null) : value);
    const data = {
      mfaMode: next,
      enrollmentDeadline: input.enrollmentDeadline === undefined ? current.enrollmentDeadline : input.enrollmentDeadline,
      sessionIdleMinutes: keep(input.sessionIdleMinutes, current.sessionIdleMinutes),
      sessionAbsoluteHours: keep(input.sessionAbsoluteHours, current.sessionAbsoluteHours),
      stepUpMaxAgeMinutes: keep(input.stepUpMaxAgeMinutes, current.stepUpMaxAgeMinutes),
      passkeysEnabled,
      requirePasskeyForAdmins,
      updatedById: actor.id,
    };
    await this.prisma.securityPolicy.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
    this.invalidate();
    const updated = await this.get(true);
    await this.audit.record({
      action: 'policy.updated', outcome: 'success', actorUserId: actor.id, req,
      context: {
        from: current.mfaMode, to: updated.mfaMode, enrollmentDeadline: updated.enrollmentDeadline, sessionIdleMinutes: updated.sessionIdleMinutes,
        sessionAbsoluteHours: updated.sessionAbsoluteHours, stepUpMaxAgeMinutes: updated.stepUpMaxAgeMinutes,
        passkeysEnabled: updated.passkeysEnabled, requirePasskeyForAdmins: updated.requirePasskeyForAdmins,
      },
    });
    return updated;
  }
}
