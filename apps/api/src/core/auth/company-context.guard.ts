import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, IS_PUBLIC_KEY } from './decorators';

/**
 * Resolves the active company from the X-Company-Id header and verifies the
 * caller is a member. Falls back to the user's default membership when the
 * header is absent. System admins may access any company.
 */
@Injectable()
export class CompanyContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return false;

    const requested = req.header('X-Company-Id');

    if (requested) {
      const company = await this.prisma.company.findFirst({ where: { id: requested, deletedAt: null, isActive: true }, select: { id: true } });
      if (!company) throw new ForbiddenException('Requested company is inactive or deleted');
      if (!user.isSystemAdmin) {
        const membership = await this.prisma.companyMembership.findUnique({
          where: {
            userId_companyId: { userId: user.id, companyId: requested },
          },
        });
        if (!membership) {
          throw new ForbiddenException('Not a member of the requested company');
        }
      }
      user.companyId = requested;
      return true;
    }

    const fallback = await this.prisma.companyMembership.findFirst({
      where: { userId: user.id, company: { deletedAt: null, isActive: true } },
      orderBy: { isDefault: 'desc' },
    });
    user.companyId = fallback?.companyId ?? null;
    return true;
  }
}
