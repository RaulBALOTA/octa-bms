import { expect, test, type Page } from '@playwright/test';
import { computePortfolio } from '../../api/src/modules/business-engine/domain/portfolio';
import { assignment, demand, resource, snapshot } from '../../api/src/modules/business-engine/domain/fixtures';

/** Mocked API backed by the real deterministic engine (synthetic fixtures, no database). */
async function setup(page: Page, permissions: string[]) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'first' }, version: 0 }));
  });
  const snap = snapshot({ asOf: '2026-01-05', horizonEnd: '2026-06-30', openingCash: '20000.00', resources: [resource('R1', { name: 'Senior PM', monthlyFixedCost: '6000.00' })],
    assignments: [assignment('A', { title: 'Plant expansion PM', fixedFee: '25000.00', end: '2026-02-27', expenses: { travel: '0', software: '0', other: '3000.00', subcontractFixed: '0' }, demand: [demand('d', { hours: 120, resourceId: 'R1' })] }),
      assignment('O', { title: 'Line 7 feasibility', commitment: 'PIPELINE', probability: 0.5, contractId: null, opportunityId: 'opp', fixedFee: '40000.00', start: '2026-03-02', end: '2026-04-30' })] });
  const result = computePortfolio(snap, 'EXPECTED', { calculatedAt: '2026-01-05T08:00:00.000Z' });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { id: 'u', firstName: 'Test', lastName: 'User', email: 'u@example.invalid', isSystemAdmin: false, permissions,
      memberships: [{ isDefault: true, company: { id: 'first', code: 'FIRST', name: 'First company' } }] } });
    if (path === '/engine/analytics/overview') return route.fulfill({ json: { result, contracted: null, topServices: result.byService, underperformingServices: [], alerts: { CRITICAL: 1 }, recommendations: [],
      definitions: { backlog: { definition: 'Remaining contracted revenue', source: 'Assignments', included: 'Contracted', excluded: 'Pipeline', basis: 'CONTRACTED' } }, meta: { excluded: [], fxWarnings: [] } } });
    if (path === '/engine/analytics/capacity') return route.fulfill({ json: { weeks: result.weeks, months: result.months, calculatedAt: result.calculatedAt, capacity: result.capacity,
      totals: { availableHours: result.totals.availableHours, internalHours: result.totals.internalHours, utilization: result.totals.utilization, shortageHours: result.totals.shortageHours }, assignments: [], meta: {} } });
    const pm = { id: 'R1', kind: 'EMPLOYEE', status: 'ACTIVE', displayName: 'Senior PM', weeklyHours: '40', maxAllocationPct: '100', nonProjectPct: '0', internal: true,
      employeeId: null, employee: null, skills: [], rates: [], ratesRedacted: true, absences: [] };
    if (path === '/engine/resources/R1') return route.fulfill({ json: pm });
    if (path === '/engine/resources') return route.fulfill({ json: [{ id: 'R1', kind: 'EMPLOYEE', status: 'ACTIVE', displayName: 'Senior PM', weeklyHours: '40', maxAllocationPct: '100', nonProjectPct: '0', internal: true,
      employee: null, skills: [], rates: [], ratesRedacted: true, absences: [] }] });
    if (path.startsWith('/engine/')) return route.fulfill({ json: path.endsWith('references') ? { clients: [], departments: [], contracts: [], opportunities: [], employees: [] } : [] });
    return route.fulfill({ json: [] });
  });
}

test('cockpit shows engine-calculated KPIs with basis labels and definitions', async ({ page }) => {
  await setup(page, ['engine.economics.read', 'engine.portfolio.read', 'engine.services.read', 'engine.resources.read']);
  await page.goto('/engine');
  await expect(page.getByRole('heading', { name: 'Business Engine — management cockpit' })).toBeVisible();
  await expect(page.getByText('€25K', { exact: true })).toBeVisible(); // contracted backlog
  await expect(page.getByText('€20K', { exact: true }).first()).toBeVisible(); // weighted pipeline 50 % × 40,000
  await expect(page.getByText('Engine settings are still illustrative defaults')).toBeVisible();
  await page.getByRole('button', { name: 'Definition' }).first().click();
  await expect(page.getByText('Remaining contracted revenue')).toBeVisible();
});

test('project managers see capacity but neither the cockpit nor personnel cost rates', async ({ page }) => {
  await setup(page, ['engine.resources.read', 'engine.portfolio.read', 'engine.services.read']);
  await page.goto('/engine');
  await expect(page.getByText('You need the permission engine.economics.read')).toBeVisible();
  await page.goto('/engine/resources');
  await expect(page.getByText('Weekly utilization (planned / available)')).toBeVisible();
  await page.getByRole('button', { name: 'Senior PM', exact: true }).click();
  await expect(page.getByText('Rates are confidential and require economics access.')).toBeVisible();
});
