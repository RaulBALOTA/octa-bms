import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_PRE_AUTH_KEY,
  type AuthenticatedRequest,
  IS_PUBLIC_KEY,
  RECENT_AUTH_KEY,
} from '../auth/decorators';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { AuthError } from './auth-errors';
import { readCookie } from './cookies';
import { safeEqual } from './crypto';
import { MfaChallengeService } from './mfa-challenge.service';
import { SecurityAuditService } from './security-audit.service';
import { SecurityPolicyService } from './security-policy.service';
import { SessionService } from './session.service';

function meta<T>(reflector: Reflector, key: string, context: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
}

/**
 * Deny-by-default authentication. Every non-@Public route needs a live server-side
 * session from the session cookie. @AllowPreAuth routes alternatively accept the
 * pre-auth challenge cookie (and then expose only `req.preAuth`). Sessions that predate
 * a stricter MFA policy are revoked and must sign in again (no silent bypass).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly challenges: MfaChallengeService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: SecurityAuditService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    if (meta<boolean>(this.reflector, IS_PUBLIC_KEY, context)) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const session = await this.sessions.validate(readCookie(req, this.config.cookie.session));
    if (session) {
      if (!session.lastMfaAt) {
        const requirement = await this.policy.requirement(session.userId, session.user);
        if (requirement.challenge || requirement.enroll) {
          await this.sessions.revoke(session.id, 'POLICY');
          await this.audit.record({ action: 'session.revoked.policy', outcome: 'success', targetUserId: session.userId, req });
          throw new AuthError('SESSION_POLICY_REAUTH');
        }
      }
      req.authSession = session;
      req.user = { id: session.user.id, email: session.user.email, isSystemAdmin: session.user.isSystemAdmin, companyId: null, permissions: [], sessionId: session.id };
      return true;
    }

    if (meta<boolean>(this.reflector, ALLOW_PRE_AUTH_KEY, context)) {
      const challenge = await this.challenges.load(readCookie(req, this.config.cookie.preAuth));
      if (challenge) {
        req.preAuth = challenge;
        return true;
      }
      throw new AuthError('MFA_CHALLENGE_INVALID');
    }
    throw new AuthError(readCookie(req, this.config.cookie.session) ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED');
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated APIs:
 *  1. unsafe methods must carry an allow-listed Origin (or Referer) — blocks cross-site
 *     form posts and login CSRF;
 *  2. session/pre-auth requests must echo the synchronizer token bound to that row in
 *     `X-CSRF-Token`;
 *  3. anonymous unsafe requests must be `application/json` (forces a CORS preflight).
 * SameSite=Strict cookies are defence in depth only.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig, private readonly audit: SecurityAuditService) {}

  private requestOrigin(req: AuthenticatedRequest): string | null {
    const origin = req.header('origin');
    if (origin) return origin;
    const referer = req.header('referer');
    if (!referer) return null;
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const reject = async (reason: string) => {
      await this.audit.record({ action: 'csrf.rejected', outcome: 'denied', actorUserId: req.user?.id ?? null, req, context: { reason, path: req.path } });
      throw new AuthError('CSRF_REJECTED');
    };

    const origin = this.requestOrigin(req);
    if (!origin || !this.config.allowedOrigins.includes(origin)) return reject('origin');

    const expected = req.authSession?.csrfToken ?? req.preAuth?.csrfToken;
    if (expected) {
      const provided = req.header('x-csrf-token');
      if (!provided || !safeEqual(provided, expected)) return reject('token');
      return true;
    }
    const contentType = (req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') return reject('content-type');
    return true;
  }
}

/** Enforces @RequireRecentAuth (step-up) on high-risk routes. */
@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: SecurityPolicyService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!meta<boolean>(this.reflector, RECENT_AUTH_KEY, context)) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = req.authSession;
    if (!session) throw new AuthError('UNAUTHENTICATED');
    const [factors, methods, policy] = await Promise.all([this.policy.factors(session.userId), this.policy.methodsFor(session.userId), this.policy.get()]);
    const hasFactor = factors.totp || factors.passkeys > 0;
    const verifiedAt = hasFactor ? session.lastMfaAt : session.lastReauthAt;
    const maxAgeMs = policy.stepUpMaxAgeMinutes * 60_000;
    if (!verifiedAt || Date.now() - verifiedAt.getTime() > maxAgeMs) {
      const available = hasFactor ? [...(methods.passkey ? ['passkey'] : []), ...(methods.totp ? ['totp'] : [])] : ['password'];
      throw new AuthError('STEP_UP_REQUIRED', undefined, { method: available[0], methods: available, maxAgeMinutes: policy.stepUpMaxAgeMinutes });
    }
    return true;
  }
}
