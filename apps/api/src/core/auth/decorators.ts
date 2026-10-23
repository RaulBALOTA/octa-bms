import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { AuthSession, MfaChallenge } from '@prisma/client';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks an endpoint as reachable without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOW_PRE_AUTH_KEY = 'allowPreAuth';
/**
 * Endpoint also accepts a pre-authentication MFA challenge (password verified, second
 * factor or enrollment pending). Such requests carry `req.preAuth`, never `req.user`.
 */
export const AllowPreAuth = () => SetMetadata(ALLOW_PRE_AUTH_KEY, true);

export const RECENT_AUTH_KEY = 'requireRecentAuth';
/** High-risk action: second factor (or password when no factor) verified within MFA_STEP_UP_MAX_AGE_MINUTES. */
export const RequireRecentAuth = () => SetMetadata(RECENT_AUTH_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Requires the caller to hold ALL listed permission codes (e.g. "crm.partners.read"). */
export const RequirePermission = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);

export interface AuthUser {
  id: string;
  email: string;
  isSystemAdmin: boolean;
  companyId: string | null;
  permissions: string[];
  sessionId?: string;
}

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
  authSession?: AuthSession;
  preAuth?: MfaChallenge;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return req.user;
  },
);

export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const companyId = req.user?.companyId;
    if (!companyId) {
      throw new Error('Company context missing — X-Company-Id header required');
    }
    return companyId;
  },
);
