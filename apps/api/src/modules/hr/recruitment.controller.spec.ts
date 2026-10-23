import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RecruitmentController } from './recruitment.controller';
import type { OrgChartService } from './org-chart.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { RbacService } from '../../core/rbac/rbac.service';
import type { AuthUser } from '../../core/auth/decorators';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';

describe('recruitment org chart positions', () => {
  it('uses effective staffing states and includes only Open positions from the selected company', async () => {
    const positions = vi.fn(async () => [
      { id: 'open', name: 'Developer', status: 'OPEN' },
      { id: 'budgeted', name: 'Planner', status: 'BUDGETED' },
      { id: 'filled', name: 'Director', status: 'FILLED' },
    ]);
    const controller = new RecruitmentController({} as PrismaService, { positions } as unknown as OrgChartService);
    expect(await controller.openPositions('selected-company')).toEqual([{ id: 'open', name: 'Developer', status: 'OPEN' }]);
    expect(positions).toHaveBeenCalledWith('selected-company');
  });

  it('allows recruitment readers to see open roles without employee-management permissions', async () => {
    const granted = new Set<string>();
    const user: AuthUser = { id: 'recruiter', email: 'hr@example.invalid', isSystemAdmin: false, companyId: 'company', permissions: [] };
    const guard = new PermissionsGuard(new Reflector(), { getPermissions: vi.fn(async () => granted) } as unknown as RbacService);
    const context = { getClass: () => RecruitmentController, getHandler: () => RecruitmentController.prototype.openPositions,
      switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    granted.add('hr.recruitment.read');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
