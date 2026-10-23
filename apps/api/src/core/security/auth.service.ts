import { Inject, Injectable } from '@nestjs/common';
import type { AuthSession, MfaChallenge, User } from '@prisma/client';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { AuthError } from './auth-errors';
import { clearAuthCookies, clearPreAuthCookie, readCookie, setPreAuthCookie, setSessionCookie } from './cookies';
import { ipBucket } from './crypto';
import { EmailNotificationService } from './email-notification.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { RATE_LIMITS, RateLimitService } from './rate-limit.service';
import { RecoveryService } from './recovery.service';
import { SecurityAuditService } from './security-audit.service';
import { SecurityPolicyService } from './security-policy.service';
import { SessionService, summarizeUserAgent } from './session.service';

export type AuthState = 'ANONYMOUS' | 'MFA_PENDING' | 'MFA_ENROLLMENT_REQUIRED' | 'AUTHENTICATED';

export interface PrimaryAuthResult {
  status: Exclude<AuthState, 'ANONYMOUS'>;
  csrfToken: string;
  expiresAt?: Date;
  enrollmentDue?: Date | null;
}

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

/**
 * Orchestrates the sign-in state machine:
 *   password ok ─┬─ factor active ──────────────► MFA_PENDING (challenge cookie only)
 *                ├─ policy requires enrollment ─► MFA_ENROLLMENT_REQUIRED (challenge cookie only)
 *                └─ otherwise ──────────────────► AUTHENTICATED (session cookie)
 * The session cookie is set only after the required second factor succeeded.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly challenges: MfaChallengeService,
    private readonly mfa: MfaService,
    private readonly recovery: RecoveryService,
    private readonly policy: SecurityPolicyService,
    private readonly limits: RateLimitService,
    private readonly audit: SecurityAuditService,
    private readonly email: EmailNotificationService,
    private readonly rbac: RbacService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  findByEmail(email: string) {
    const normalized = normalizeEmail(email);
    return this.prisma.user.findFirst({ where: { OR: [{ emailNormalized: normalized }, { email: normalized }], deletedAt: null } });
  }

  private canSignIn(user: User): boolean {
    return user.isActive && !user.deletedAt && user.status === 'ACTIVE';
  }

  async login(email: string, password: string, req: Request, res: Response): Promise<PrimaryAuthResult> {
    const normalized = normalizeEmail(email);
    const ip = ipBucket(req.ip);
    await this.limits.assertHit(RATE_LIMITS.loginIp, ip);
    // budgets keyed by the *submitted* email: identical behaviour for unknown accounts
    await this.limits.assertBelow(RATE_LIMITS.loginAccountFailures, normalized);
    await this.limits.assertBelow(RATE_LIMITS.loginIpAccountFailures, `${ip}|${normalized}`);

    const user = await this.findByEmail(normalized);
    let valid = false;
    if (user?.passwordHash) {
      const result = await this.passwords.verify(user.passwordHash, password);
      valid = result.valid;
      if (valid && result.needsRehash) {
        await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(password) } });
      }
    } else {
      await this.passwords.verifyDummy(password);
    }

    if (!user || !valid || !this.canSignIn(user)) {
      await Promise.all([
        this.limits.hit(RATE_LIMITS.loginAccountFailures, normalized),
        this.limits.hit(RATE_LIMITS.loginIpAccountFailures, `${ip}|${normalized}`),
      ]);
      if (user) await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
      await this.audit.record({
        action: 'auth.login', outcome: 'failure', targetUserId: user?.id ?? null, req,
        context: { reason: !user ? 'unknown_account' : !valid ? 'bad_password' : 'account_inactive' },
      });
      throw new AuthError('INVALID_CREDENTIALS');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    return this.completePrimaryAuth(user, 'password', req, res);
  }

  /** Shared by password and OIDC sign-in: decides whether a second factor or enrollment is needed. */
  async completePrimaryAuth(user: User, method: 'password' | 'oidc', req: Request, res: Response): Promise<PrimaryAuthResult> {
    const requirement = await this.policy.requirement(user.id, user);
    if (requirement.challenge || requirement.enroll) {
      const purpose = requirement.challenge ? 'LOGIN' : 'ENROLL';
      const { token, challenge } = await this.challenges.create(user.id, purpose, method, req);
      clearAuthCookies(res, this.config);
      setPreAuthCookie(res, this.config, token, challenge.expiresAt);
      await this.audit.record({ action: 'auth.primary', outcome: 'success', targetUserId: user.id, req, context: { method, next: purpose } });
      return { status: purpose === 'LOGIN' ? 'MFA_PENDING' : 'MFA_ENROLLMENT_REQUIRED', csrfToken: challenge.csrfToken, expiresAt: challenge.expiresAt };
    }
    const session = await this.startSession(user, { mfa: false, method, via: 'password' }, req, res);
    return { status: 'AUTHENTICATED', csrfToken: session.csrfToken, enrollmentDue: requirement.enrollmentDue };
  }

  /** Creates the full session (new identifier), clears pre-auth state. */
  async startSession(user: Pick<User, 'id' | 'email'>, opts: { mfa: boolean; method: 'password' | 'oidc'; via: string }, req: Request, res: Response): Promise<AuthSession> {
    const previous = await this.prisma.authSession.findFirst({
      where: { userId: user.id, userAgent: summarizeUserAgent(req.header('user-agent')), issuedAt: { gt: new Date(Date.now() - 90 * 86_400_000) } },
      select: { id: true },
    });
    // a pre-existing session cookie in this browser is never promoted (fixation)
    const existing = await this.sessions.validate(readCookie(req, this.config.cookie.session));
    if (existing) await this.sessions.revoke(existing.id, 'ROTATED');
    const { token, session } = await this.sessions.create({ userId: user.id, mfa: opts.mfa, method: opts.method, req });
    clearPreAuthCookie(res, this.config);
    setSessionCookie(res, this.config, token, session.absoluteExpiresAt);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ action: 'auth.login', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req, context: { method: opts.method, via: opts.via, mfa: opts.mfa, sessionId: session.id } });
    if (!previous) {
      this.email.notify(user.email, { kind: 'new-sign-in', when: session.issuedAt.toISOString(), device: session.userAgent ?? 'unknown device' }, user.id);
    }
    return session;
  }

  private async userForChallenge(challenge: MfaChallenge): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !this.canSignIn(user)) throw new AuthError('MFA_CHALLENGE_INVALID');
    return user;
  }

  async verifyTotp(challenge: MfaChallenge, code: string, req: Request, res: Response): Promise<PrimaryAuthResult> {
    if (challenge.purpose !== 'LOGIN') throw new AuthError('MFA_CHALLENGE_INVALID');
    await this.limits.assertHit(RATE_LIMITS.mfaIp, ipBucket(req.ip));
    await this.limits.assertBelow(RATE_LIMITS.mfaUserFailures, challenge.userId);
    if (!(await this.challenges.reserveAttempt(challenge.id))) throw new AuthError('MFA_CHALLENGE_INVALID');
    const user = await this.userForChallenge(challenge);

    const ok = await this.prisma.$transaction(async (tx) => {
      if (!(await this.mfa.verify(user.id, code, tx))) return false;
      // consume inside the same transaction: if another request already consumed the
      // challenge, the accepted time step is rolled back as well
      if (!(await this.challenges.consume(challenge.id, tx))) throw new AuthError('MFA_CHALLENGE_INVALID');
      return true;
    });
    if (!ok) {
      await this.limits.hit(RATE_LIMITS.mfaUserFailures, user.id);
      await this.audit.record({ action: 'mfa.totp.verify', outcome: 'failure', targetUserId: user.id, req, context: { attempt: challenge.attempts + 1 } });
      throw new AuthError('MFA_CODE_INVALID', undefined, { attemptsRemaining: Math.max(0, challenge.maxAttempts - challenge.attempts - 1) });
    }
    await this.audit.record({ action: 'mfa.totp.verify', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req });
    const session = await this.startSession(user, { mfa: true, method: challenge.authMethod as 'password' | 'oidc', via: 'totp' }, req, res);
    return { status: 'AUTHENTICATED', csrfToken: session.csrfToken };
  }

  async redeemRecoveryCode(challenge: MfaChallenge, code: string, req: Request, res: Response): Promise<PrimaryAuthResult & { recoveryCodesRemaining: number }> {
    if (challenge.purpose !== 'LOGIN') throw new AuthError('MFA_CHALLENGE_INVALID');
    await this.limits.assertHit(RATE_LIMITS.mfaIp, ipBucket(req.ip));
    await this.limits.assertBelow(RATE_LIMITS.recoveryUserFailures, challenge.userId);
    if (!(await this.challenges.reserveAttempt(challenge.id))) throw new AuthError('MFA_CHALLENGE_INVALID');
    const user = await this.userForChallenge(challenge);

    const ok = await this.prisma.$transaction(async (tx) => {
      if (!(await this.recovery.redeem(user.id, code, tx))) return false;
      if (!(await this.challenges.consume(challenge.id, tx))) throw new AuthError('MFA_CHALLENGE_INVALID');
      return true;
    });
    if (!ok) {
      await this.limits.hit(RATE_LIMITS.recoveryUserFailures, user.id);
      await this.audit.record({ action: 'mfa.recovery_code.redeem', outcome: 'failure', targetUserId: user.id, req });
      throw new AuthError('RECOVERY_CODE_INVALID');
    }
    const remaining = await this.recovery.remaining(user.id);
    await this.audit.record({ action: 'mfa.recovery_code.redeem', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req, context: { remaining } });
    this.email.notify(user.email, { kind: 'recovery-code-used', remaining }, user.id);
    const session = await this.startSession(user, { mfa: true, method: challenge.authMethod as 'password' | 'oidc', via: 'recovery_code' }, req, res);
    return { status: 'AUTHENTICATED', csrfToken: session.csrfToken, recoveryCodesRemaining: remaining };
  }

  /** Reports the caller's position in the state machine (drives the SPA route guards). */
  async state(req: Request) {
    const session = await this.sessions.validate(readCookie(req, this.config.cookie.session));
    if (session) {
      const requirement = await this.policy.requirement(session.userId, session.user);
      if (session.lastMfaAt || (!requirement.challenge && !requirement.enroll)) {
        return {
          state: 'AUTHENTICATED' as const,
          csrfToken: session.csrfToken,
          session: { idleExpiresAt: session.idleExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt },
          mfa: { enrolled: requirement.challenge, required: requirement.required, enrollmentDue: requirement.enrollmentDue },
        };
      }
    }
    const challenge = await this.challenges.load(readCookie(req, this.config.cookie.preAuth));
    if (challenge) {
      return {
        state: challenge.purpose === 'LOGIN' ? ('MFA_PENDING' as const) : ('MFA_ENROLLMENT_REQUIRED' as const),
        csrfToken: challenge.csrfToken,
        expiresAt: challenge.expiresAt,
        attemptsRemaining: challenge.maxAttempts - challenge.attempts,
      };
    }
    return { state: 'ANONYMOUS' as const };
  }

  async logout(req: Request, res: Response): Promise<void> {
    const session = await this.sessions.validate(readCookie(req, this.config.cookie.session));
    if (session) {
      await this.sessions.revoke(session.id, 'LOGOUT');
      await this.audit.record({ action: 'auth.logout', outcome: 'success', actorUserId: session.userId, targetUserId: session.userId, req });
    }
    const challenge = await this.challenges.load(readCookie(req, this.config.cookie.preAuth));
    if (challenge) await this.challenges.consume(challenge.id);
    clearAuthCookies(res, this.config);
  }

  /** Step-up: TOTP when a factor is active, otherwise the current password. Rotates the session id. */
  async stepUp(session: AuthSession, input: { code?: string; password?: string }, req: Request, res: Response) {
    await this.limits.assertBelow(RATE_LIMITS.stepUpUserFailures, session.userId);
    const factor = await this.mfa.activeAuthenticator(session.userId);
    let ok = false;
    if (factor) {
      ok = !!input.code && (await this.mfa.verify(session.userId, input.code));
    } else if (input.password) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
      ok = !!user.passwordHash && (await this.passwords.verify(user.passwordHash, input.password)).valid;
    }
    if (!ok) {
      await this.limits.hit(RATE_LIMITS.stepUpUserFailures, session.userId);
      await this.audit.record({ action: 'auth.step_up', outcome: 'failure', actorUserId: session.userId, targetUserId: session.userId, req, context: { method: factor ? 'totp' : 'password' } });
      throw new AuthError('STEP_UP_INVALID');
    }
    const rotated = await this.sessions.rotate(session, { mfa: !!factor, reauth: true, req });
    setSessionCookie(res, this.config, rotated.token, rotated.session.absoluteExpiresAt);
    await this.audit.record({ action: 'auth.step_up', outcome: 'success', actorUserId: session.userId, targetUserId: session.userId, req, context: { method: factor ? 'totp' : 'password' } });
    return { csrfToken: rotated.session.csrfToken, verifiedAt: new Date(), validForMinutes: this.config.mfa.stepUpMaxAgeMinutes };
  }

  async stepUpMethod(userId: string) {
    const factor = await this.mfa.activeAuthenticator(userId);
    return { method: factor ? ('totp' as const) : ('password' as const), maxAgeMinutes: this.config.mfa.stepUpMaxAgeMinutes };
  }

  /** Minimal identity, memberships, effective permissions and security posture. */
  async me(userId: string, session?: AuthSession) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true, displayName: true, avatarUrl: true,
        locale: true, theme: true, isSystemAdmin: true, mfaRequired: true,
        memberships: {
          where: { company: { deletedAt: null, isActive: true } },
          select: { isDefault: true, company: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    const defaultCompany = user.memberships.find((m) => m.isDefault)?.company ?? user.memberships[0]?.company;
    const memberships = user.isSystemAdmin
      ? (await this.prisma.company.findMany({
          where: { deletedAt: null, isActive: true },
          select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
        })).map((company, index) => ({ isDefault: defaultCompany ? company.id === defaultCompany.id : index === 0, company }))
      : user.memberships;
    const permissions = user.isSystemAdmin ? ['*'] : [...(await this.rbac.getPermissions(user.id, defaultCompany?.id ?? null))];
    const [status, requirement] = await Promise.all([this.mfa.status(user.id), this.policy.requirement(user.id, user)]);
    const { mfaRequired: _cohort, ...profile } = user;
    return {
      ...profile,
      memberships,
      permissions,
      mfa: { ...status, required: requirement.required, enrollmentDue: requirement.enrollmentDue },
      session: session ? { id: session.id, lastMfaAt: session.lastMfaAt, absoluteExpiresAt: session.absoluteExpiresAt, idleExpiresAt: session.idleExpiresAt } : undefined,
    };
  }
}
