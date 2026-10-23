import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../auth/decorators';
import { RbacService } from './rbac.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context
      .switchToHttp()
      .getRequest<Request & { user: AuthUser; preAuth?: unknown }>();
    const user = req.user;
    // pre-auth requests may only reach @AllowPreAuth routes, which declare no permissions
    if (!user) return Boolean(req.preAuth) && !required?.length;

    // Always resolve the effective set (cached) so downstream handlers can
    // apply row/field-level filtering via user.permissions.
    if (!user.isSystemAdmin) {
      const granted = await this.rbac.getPermissions(user.id, user.companyId);
      user.permissions = [...granted];
    }

    if (!required?.length || user.isSystemAdmin) return true;

    const grantedSet = new Set(user.permissions);
    const missing = required.filter((code) => !grantedSet.has(code));
    if (missing.length) {
      throw new ForbiddenException(
        `Missing permissions: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
