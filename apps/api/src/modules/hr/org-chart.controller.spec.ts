import 'reflect-metadata';
import { BadRequestException, ForbiddenException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AuthUser } from '../../core/auth/decorators';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import type { RbacService } from '../../core/rbac/rbac.service';
import { OrgChartController, PositionStatusDto, SaveOrgChartVersionDto } from './org-chart.controller';

describe('org chart access and input validation', () => {
  it.each([
    ['versions', ['hr.employees.read']], ['version', ['hr.employees.read']],
    ['save', ['hr.employees.read', 'hr.employees.update']], ['status', ['hr.employees.read', 'hr.employees.update']],
  ] as const)('requires the appropriate permissions for %s', async (method, permissions) => {
    const granted = new Set<string>();
    const user: AuthUser = { id: 'member', email: 'hr@example.invalid', companyId: 'company', isSystemAdmin: false, permissions: [] };
    const guard = new PermissionsGuard(new Reflector(), { getPermissions: vi.fn(async () => granted) } as unknown as RbacService);
    const context = { getClass: () => OrgChartController, getHandler: () => OrgChartController.prototype[method],
      switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
    for (const permission of permissions) {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
      granted.add(permission);
    }
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it('rejects unknown statuses and client-controlled snapshots/version numbers', async () => {
    await expect(pipe.transform({ status: 'UNKNOWN' }, { type: 'body', metatype: PositionStatusDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ title: 'Saved', snapshot: {}, version: 99 }, { type: 'body', metatype: SaveOrgChartVersionDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ title: '   ' }, { type: 'body', metatype: SaveOrgChartVersionDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
