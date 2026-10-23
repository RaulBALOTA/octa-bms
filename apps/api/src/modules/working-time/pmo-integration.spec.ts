import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PmoClient, pmoConfigFromEnv } from './pmo-client';
import { planPmoImport, removalBoundary, type ExistingPmoEntry, type IncomingPmoEntry } from './pmo-mapping';
import { PmoIntegrationController, TimePlanningController, WorkingTimeController } from './working-time.controller';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import type { RbacService } from '../../core/rbac/rbac.service';
import type { AuthUser } from '../../core/auth/decorators';

const entry = (over: Partial<IncomingPmoEntry> = {}): IncomingPmoEntry => ({
  externalId: '1', email: 'Ana.Engineer@octa.example', resourceName: 'Ana', date: '2026-10-20', hours: 7.5,
  projectCode: 'P-100', projectName: 'Refinery Revamp', taskRef: 'Piping ISO', billable: true, description: null, ...over,
});
const existing = (over: Partial<ExistingPmoEntry> = {}): ExistingPmoEntry => ({
  id: 'row-1', externalId: '1', employeeId: 'emp-1', date: '2026-10-20', minutes: 450, projectCode: 'P-100',
  projectName: 'Refinery Revamp', taskRef: 'Piping ISO', billable: true, description: null, ...over,
});
const employees = new Map([['ana.engineer@octa.example', 'emp-1']]);

describe('PMO import planning', () => {
  it('creates, updates and leaves unchanged entries matched by e-mail', () => {
    const plan = planPmoImport({
      incoming: [entry(), entry({ externalId: '2', hours: 1 }), entry({ externalId: '3', email: 'nobody@x.example', hours: 2 })],
      existing: [existing(), existing({ id: 'row-2', externalId: '2', minutes: 30 })],
      employeesByEmail: employees, lockedWeeks: new Set(), removeFrom: '2026-10-01',
    });
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ id: 'row-2', data: expect.objectContaining({ minutes: 60 }) }]);
    expect(plan.unmatched).toEqual([{ email: 'nobody@x.example', resourceName: 'Ana', entries: 1, hours: 2 }]);
  });

  it('removes entries PMO no longer reports, but never inside locked weeks or before the boundary', () => {
    const plan = planPmoImport({
      incoming: [entry({ externalId: '9' })],
      existing: [existing({ id: 'gone' , externalId: '7' }), existing({ id: 'old', externalId: '8', date: '2026-09-01' }), existing({ id: 'locked', externalId: '6', date: '2026-10-13' })],
      employeesByEmail: employees, lockedWeeks: new Set(['emp-1:2026-10-12']), removeFrom: '2026-10-01',
    });
    expect(plan.create.map((c) => c.externalId)).toEqual(['9']);
    expect(plan.remove).toEqual(['gone']);
    expect(plan.skipped).toEqual([{ externalId: '6', reason: 'LOCKED_WEEK' }]);
  });

  it('defaults entries without a project and rejects implausible hours', () => {
    const plan = planPmoImport({
      incoming: [entry({ projectCode: null, projectName: null }), entry({ externalId: '2', hours: 30 })],
      existing: [], employeesByEmail: employees, lockedWeeks: new Set(), removeFrom: null,
    });
    expect(plan.create[0].projectCode).toBe('UNASSIGNED');
    expect(plan.skipped).toEqual([{ externalId: '2', reason: 'INVALID' }]);
  });

  it('only prunes fully received days when PMO truncates the response', () => {
    expect(removalBoundary('2026-09-18', [{ date: '2026-10-20' }], 500)).toBe('2026-09-18');
    const capped = Array.from({ length: 500 }, (_, i) => ({ date: i < 499 ? '2026-10-20' : '2026-10-05' }));
    expect(removalBoundary('2026-09-18', capped, 500)).toBe('2026-10-06');
  });
});

describe('PMO client', () => {
  it('logs in once and reads timesheets, users and projects with the PMO JWT', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
      const body = url.endsWith('/api/auth/login') ? { token: 'jwt' }
        : url.includes('/timesheets') ? { rows: [{ id: 1 }], totals: {} }
          : [{ id: 1 }];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const client = new PmoClient({ baseUrl: 'http://pmo:4000', email: 'svc@pmo', password: 'secret', days: 35, timeoutMs: 1000 }, fetcher);
    await client.timesheets();
    await client.users();
    await client.projects();
    expect(calls.map((c) => c.url)).toEqual([
      'http://pmo:4000/api/auth/login', 'http://pmo:4000/api/workforce/timesheets?days=35', 'http://pmo:4000/api/users', 'http://pmo:4000/api/projects?archived=include',
    ]);
    expect(calls.slice(1).every((c) => c.auth === 'Bearer jwt')).toBe(true);
  });

  it('surfaces PMO errors and requires complete configuration', async () => {
    const client = new PmoClient({ baseUrl: 'http://pmo', email: 'a', password: 'b', days: 1, timeoutMs: 1000 },
      async () => new Response(JSON.stringify({ error: 'invalid creds' }), { status: 401 }));
    await expect(client.users()).rejects.toThrow('PMO POST /api/auth/login failed (401): invalid creds');
    expect(pmoConfigFromEnv({ PMO_API_URL: 'http://pmo/', PMO_SERVICE_EMAIL: 'a' })).toBeNull();
    expect(pmoConfigFromEnv({ PMO_API_URL: 'http://pmo/', PMO_SERVICE_EMAIL: 'a', PMO_SERVICE_PASSWORD: 'b', PMO_SYNC_DAYS: '900' })).toMatchObject({ baseUrl: 'http://pmo', days: 365 });
  });
});

describe('working-time permissions', () => {
  const cases: [object, string, string[]][] = [
    [WorkingTimeController, 'week', ['time.records.read']],
    [WorkingTimeController, 'createRecord', ['time.records.create']],
    [WorkingTimeController, 'clockOut', ['time.records.update']],
    [WorkingTimeController, 'deleteEntry', ['time.records.delete']],
    [WorkingTimeController, 'submit', ['time.timesheets.create']],
    [WorkingTimeController, 'decide', ['time.timesheets.approve']],
    [WorkingTimeController, 'team', ['time.timesheets.approve']],
    [WorkingTimeController, 'exportCsv', ['time.timesheets.export']],
    [TimePlanningController, 'capacity', ['time.planning.read']],
    [TimePlanningController, 'allocate', ['time.planning.create']],
    [TimePlanningController, 'assign', ['time.schedules.update']],
    [PmoIntegrationController, 'sync', ['time.integration.create']],
    [PmoIntegrationController, 'push', ['time.integration.create']],
    [PmoIntegrationController, 'capacity', ['time.integration.read']],
  ];
  it.each(cases)('%o.%s requires %j', async (controller, method, permissions) => {
    const granted = new Set<string>();
    const user: AuthUser = { id: 'user', email: 'test@example.invalid', isSystemAdmin: false, companyId: 'company', permissions: [] };
    const guard = new PermissionsGuard(new Reflector(), { getPermissions: vi.fn(async () => granted) } as unknown as RbacService);
    const handler = (controller as { prototype: Record<string, unknown> }).prototype[method];
    const context = { getClass: () => controller, getHandler: () => handler, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    for (const permission of permissions) granted.add(permission);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
