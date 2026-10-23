import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks an endpoint as reachable without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

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
}

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
      throw new BadRequestException({
        code: 'COMPANY_CONTEXT_REQUIRED',
        message: 'Company context missing — X-Company-Id header required',
      });
    }
    return companyId;
  },
);
