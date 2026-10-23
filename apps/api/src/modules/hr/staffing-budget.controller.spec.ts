import 'reflect-metadata';
import { BadRequestException, ForbiddenException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { StaffingBudgetController } from './staffing-budget.controller';
import { StaffingBudgetDto } from './staffing-budget.dto';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import type { RbacService } from '../../core/rbac/rbac.service';
import type { AuthUser } from '../../core/auth/decorators';

describe('staffing budget access and validation', () => {
  it.each([
    ['context', ['finance.budgets.read']], ['calculate', ['finance.budgets.read']], ['list', ['finance.budgets.read']],
    ['get', ['finance.budgets.read']], ['revision', ['finance.budgets.read']],
    ['create', ['finance.budgets.read', 'finance.budgets.create']], ['update', ['finance.budgets.read', 'finance.budgets.update']],
  ] as const)('requires budget permissions for %s', async (method, permissions) => {
    const granted = new Set<string>();
    const user: AuthUser = { id: 'user', email: 'test@example.invalid', isSystemAdmin: false, companyId: 'company', permissions: [] };
    const guard = new PermissionsGuard(new Reflector(), { getPermissions: vi.fn(async () => granted) } as unknown as RbacService);
    const context = { getClass: () => StaffingBudgetController, getHandler: () => StaffingBudgetController.prototype[method],
      switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
    for (const permission of permissions) { await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException); granted.add(permission); }
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
  it('validates nested financial inputs and rejects client-supplied results', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const input = { title: 'Plan', year: 2026, includeOpen: true, includeBudgeted: true, lines: [{ positionId: 'position', headcount: 1, fte: 1,
      annualSalary: '60000', annualBonus: '0', monthlyBenefits: '0', employerCostPct: 0, recruitingCost: '0',
      plannedStart: '2026-01-01', forecastStart: '2026-01-01', hiringProbability: 100 }] };
    await expect(pipe.transform(input, { type: 'body', metatype: StaffingBudgetDto })).resolves.toBeInstanceOf(StaffingBudgetDto);
    await expect(pipe.transform({ ...input, result: { budget: 1 } }, { type: 'body', metatype: StaffingBudgetDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...input, lines: [{ ...input.lines[0], annualSalary: '-1', fte: 2, hiringProbability: 110 }] }, { type: 'body', metatype: StaffingBudgetDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
