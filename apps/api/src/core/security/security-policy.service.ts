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
  source: 'database' | 'environment';
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

  async requirement(userId: string, user: { mfaRequired: boolean }): Promise<MfaRequirement> {
    const [policy, factors] = await Promise.all([
      this.get(),
      this.prisma.mfaAuthenticator.count({ where: { userId, status: 'ACTIVE' } }),
    ]);
    return this.requirementFor(policy, user, factors > 0);
  }

  /** Admins with an active factor; enforcement needs at least two (recoverability). */
  async enrolledAdminCount(): Promise<number> {
    return this.prisma.user.count({
      where: { isSystemAdmin: true, isActive: true, deletedAt: null, mfaAuthenticators: { some: { status: 'ACTIVE' } } },
    });
  }

  async update(
    actor: { id: string; isSystemAdmin: boolean },
    input: { mfaMode?: MfaPolicyMode; enrollmentDeadline?: Date | null; sessionIdleMinutes?: number | null; sessionAbsoluteHours?: number | null },
    req?: Parameters<SecurityAuditService['record']>[0]['req'],
  ): Promise<EffectivePolicy> {
    if (!actor.isSystemAdmin) throw new AuthError('FORBIDDEN');
    const current = await this.get(true);
    const next = input.mfaMode ?? current.mfaMode;
    if (next === 'ENROLLMENT_REQUIRED' || next === 'ENFORCED') {
      const actorFactor = await this.prisma.mfaAuthenticator.count({ where: { userId: actor.id, status: 'ACTIVE' } });
      if (!actorFactor) throw new AuthError('POLICY_CHANGE_REJECTED', 'Register your own authenticator before requiring MFA for others');
    }
    if (next === 'ENFORCED') {
      const admins = await this.enrolledAdminCount();
      if (admins < 2) {
        throw new AuthError('POLICY_CHANGE_REJECTED', 'Enforcement requires at least two system administrators with an active authenticator and saved recovery codes', { enrolledAdmins: admins });
      }
    }
    if (input.sessionIdleMinutes != null && (input.sessionIdleMinutes < 5 || input.sessionIdleMinutes > 1440)) throw new AuthError('POLICY_CHANGE_REJECTED', 'Idle timeout must be 5–1440 minutes');
    if (input.sessionAbsoluteHours != null && (input.sessionAbsoluteHours < 1 || input.sessionAbsoluteHours > 336)) throw new AuthError('POLICY_CHANGE_REJECTED', 'Absolute lifetime must be 1–336 hours');
    const data = {
      mfaMode: next,
      enrollmentDeadline: input.enrollmentDeadline === undefined ? current.enrollmentDeadline : input.enrollmentDeadline,
      sessionIdleMinutes: input.sessionIdleMinutes === undefined ? (current.source === 'database' ? current.sessionIdleMinutes : null) : input.sessionIdleMinutes,
      sessionAbsoluteHours: input.sessionAbsoluteHours === undefined ? (current.source === 'database' ? current.sessionAbsoluteHours : null) : input.sessionAbsoluteHours,
      updatedById: actor.id,
    };
    await this.prisma.securityPolicy.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
    this.invalidate();
    const updated = await this.get(true);
    await this.audit.record({
      action: 'policy.updated', outcome: 'success', actorUserId: actor.id, req,
      context: { from: current.mfaMode, to: updated.mfaMode, enrollmentDeadline: updated.enrollmentDeadline, sessionIdleMinutes: updated.sessionIdleMinutes, sessionAbsoluteHours: updated.sessionAbsoluteHours },
    });
    return updated;
  }
}
