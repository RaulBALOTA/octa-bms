import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { GoalsController } from './goals.controller';
import { AnnouncementsController } from './announcements.controller';
import { CompaniesController } from '../master-data/companies.controller';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import type { RbacService } from '../../core/rbac/rbac.service';
import { CompanyContextGuard } from '../../core/auth/company-context.guard';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../core/auth/decorators';

const endpoints = [
  [GoalsController, GoalsController.prototype.get, 'corporate.goals.read'],
  [GoalsController, GoalsController.prototype.create, 'corporate.goals.create'],
  [GoalsController, GoalsController.prototype.update, 'corporate.goals.update'],
  [GoalsController, GoalsController.prototype.remove, 'corporate.goals.delete'],
  [AnnouncementsController, AnnouncementsController.prototype.create, 'corporate.announcements.create'],
  [AnnouncementsController, AnnouncementsController.prototype.update, 'corporate.announcements.update'],
  [AnnouncementsController, AnnouncementsController.prototype.remove, 'corporate.announcements.delete'],
  [CompaniesController, CompaniesController.prototype.list, 'admin.masterdata.read'],
  [CompaniesController, CompaniesController.prototype.create, 'admin.masterdata.create'],
  [CompaniesController, CompaniesController.prototype.update, 'admin.masterdata.update'],
  [CompaniesController, CompaniesController.prototype.remove, 'admin.masterdata.delete'],
  [CompaniesController, CompaniesController.prototype.getOffice, 'admin.masterdata.read'],
  [CompaniesController, CompaniesController.prototype.createOffice, 'admin.masterdata.create'],
  [CompaniesController, CompaniesController.prototype.updateOffice, 'admin.masterdata.update'],
  [CompaniesController, CompaniesController.prototype.removeOffice, 'admin.masterdata.delete'],
] as const;

describe('corporate and organization endpoint permissions', () => {
  it.each(endpoints)('enforces %s handler permission %s', async (controller, handler, permission) => {
    const user: AuthUser = { id: 'user', email: 'test@example.com', isSystemAdmin: false, companyId: 'company', permissions: [] };
    const granted = new Set<string>();
    const rbac = { getPermissions: vi.fn(async () => granted) };
    const guard = new PermissionsGuard(new Reflector(), rbac as unknown as RbacService);
    const context = { getHandler: () => handler, getClass: () => controller, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    granted.add(permission); await expect(guard.canActivate(context)).resolves.toBe(true);
    granted.clear(); user.isSystemAdmin = true; await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe('inactive or deleted company context', () => {
  it('rejects an unavailable company even for a system admin', async () => {
    const prisma = { company: { findFirst: vi.fn(async () => null) } };
    const guard = new CompanyContextGuard(new Reflector(), prisma as unknown as PrismaService);
    const context = { getHandler: () => (() => undefined), getClass: () => CompaniesController, switchToHttp: () => ({ getRequest: () => ({ header: () => 'deleted', user: { isSystemAdmin: true } }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('chooses a fallback membership only from active companies', async () => {
    const findFirst = vi.fn(async () => ({ companyId: 'active' }));
    const guard = new CompanyContextGuard(new Reflector(), { companyMembership: { findFirst } } as unknown as PrismaService);
    const user = { id: 'user', companyId: null as string | null };
    const context = { getHandler: () => (() => undefined), getClass: () => CompaniesController, switchToHttp: () => ({ getRequest: () => ({ header: () => undefined, user }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 'user', company: { isActive: true, deletedAt: null } }, orderBy: { isDefault: 'desc' } });
    expect(user.companyId).toBe('active');
  });
});
