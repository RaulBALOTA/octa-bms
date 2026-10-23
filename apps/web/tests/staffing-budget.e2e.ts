import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { calculateStaffingBudget } from '../../api/src/modules/hr/staffing-budget.calculation';
import type { StaffingBudgetContext, StaffingBudgetInput, StaffingBudgetScenario } from '../../../packages/shared/src/staffing-budget';

async function setup(page: Page, editor = true) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'first' }, version: 0 }));
  });
  const department = { id: 'engineering', code: 'ENG', name: 'Engineering' };
  const contexts: Record<string, StaffingBudgetContext> = {
    first: { company: { name: 'First company', currency: 'EUR', fiscalYearStart: 1 }, departments: [department],
      offices: [{ id: 'hq', code: 'HQ', name: 'Berlin', city: 'Berlin' }], positions: [
        { id: 'developer', code: 'DEV', name: 'Developer', status: 'OPEN', department },
        { id: 'planner', code: 'PLAN', name: 'Planner', status: 'BUDGETED', department },
      ] },
    second: { company: { name: 'Second company', currency: 'GBP', fiscalYearStart: 4 },
      departments: [{ id: 'second-dept', code: 'SECOND', name: 'Second department' }],
      offices: [{ id: 'second-office', code: 'SECOND', name: 'London', city: 'London' }],
      positions: [{ id: 'second-role', code: 'SECOND', name: 'Second role', status: 'OPEN', department: { id: 'second-dept', name: 'Second department' } }] },
  };
  const scenarios: (StaffingBudgetScenario & { companyId: string })[] = [];
  const revisions = new Map<string, { plan: StaffingBudgetInput; result: StaffingBudgetScenario['result'] }>();
  const requests: { companyId: string; body: StaffingBudgetInput }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const companyId = request.headers()['x-company-id'] ?? 'first';
    const context = contexts[companyId];
    // cookie session model: the SPA asks /auth/state before rendering protected routes
    if (path === '/auth/state') return route.fulfill({ json: { state: 'AUTHENTICATED', csrfToken: 'test-csrf' } });
    if (path === '/auth/me') return route.fulfill({ json: { id: 'user', firstName: 'Budget', lastName: 'User', email: 'budget@example.invalid', isSystemAdmin: false,
      permissions: ['finance.budgets.read', ...(editor ? ['finance.budgets.create', 'finance.budgets.update'] : [])], memberships: [
        { isDefault: true, company: { id: 'first', code: 'FIRST', name: 'First company' } },
        { isDefault: false, company: { id: 'second', code: 'SECOND', name: 'Second company' } },
      ] } });
    if (path === '/hr/staffing-budgets/context') return route.fulfill({ json: context });
    if (path === '/hr/staffing-budgets' && request.method() === 'GET') return route.fulfill({ json: scenarios.filter((row) => row.companyId === companyId) });
    if (path === '/hr/staffing-budgets/calculate' || path === '/hr/staffing-budgets' && request.method() === 'POST' || path.startsWith('/hr/staffing-budgets/') && request.method() === 'PUT') {
      const body = request.postDataJSON() as StaffingBudgetInput;
      requests.push({ companyId, body });
      const result = calculateStaffingBudget(body.year, context.company.fiscalYearStart, context.company.currency, body.lines.map((line) => {
        const position = context.positions.find((row) => row.id === line.positionId)!;
        return { ...line, name: position.name, code: position.code, status: position.status, department: position.department,
          office: line.officeId ? context.offices.find((row) => row.id === line.officeId)! : null };
      }));
      const { expectedVersion: _version, note, ...plan } = body;
      if (path === '/hr/staffing-budgets/calculate') return route.fulfill({ json: { plan, result } });
      let scenario = request.method() === 'PUT' ? scenarios.find((row) => row.id === path.split('/')[3]) : undefined;
      if (scenario && scenario.version !== body.expectedVersion) return route.fulfill({ status: 409, json: { message: 'This plan has changed' } });
      if (!scenario) {
        scenario = { id: `plan-${scenarios.length + 1}`, companyId, title: body.title, year: body.year, currency: result.currency,
          fiscalYearStart: result.fiscalYearStart, version: 0, updatedAt: '2026-10-12T10:00:00Z', plan, result, revisions: [] };
        scenarios.push(scenario);
      }
      Object.assign(scenario, { title: body.title, year: body.year, plan: structuredClone(plan), result: structuredClone(result), version: scenario.version + 1 });
      scenario.revisions.unshift({ version: scenario.version, note: note ?? null, createdAt: '2026-10-12T10:00:00Z', createdBy: { firstName: 'Budget', lastName: 'User' } });
      revisions.set(`${scenario.id}:${scenario.version}`, { plan: structuredClone(plan), result: structuredClone(result) });
      return route.fulfill({ json: scenario });
    }
    const match = /^\/hr\/staffing-budgets\/([^/]+)(?:\/revisions\/(\d+))?$/.exec(path);
    if (match) {
      const scenario = scenarios.find((row) => row.id === match[1] && row.companyId === companyId);
      return scenario ? route.fulfill({ json: match[2] ? revisions.get(`${match[1]}:${match[2]}`) : scenario })
        : route.fulfill({ status: 404, json: { message: 'Plan not found' } });
    }
    return route.fulfill({ json: { count: 0 } });
  });
  await page.goto('/hr/staffing-budgets');
  await expect(page.getByRole('textbox', { name: /^Plan title/ })).toBeVisible();
  return { scenarios, requests };
}

test('calculates, saves, revises, reloads and exports a staffing budget and forecast', async ({ page }) => {
  const { scenarios } = await setup(page);
  await page.getByRole('textbox', { name: /^Plan title/ }).fill('Engineering hires');
  await page.getByRole('spinbutton', { name: 'Fiscal start year', exact: true }).fill('2026');
  await page.getByRole('checkbox', { name: 'Include Budgeted positions', exact: true }).uncheck();
  const developer = page.getByRole('group', { name: 'Developer', exact: true });
  await developer.getByRole('spinbutton', { name: 'Planned hires', exact: true }).fill('2');
  await developer.getByRole('spinbutton', { name: 'FTE per hire', exact: true }).fill('0.5');
  await developer.getByRole('spinbutton', { name: 'Annual salary', exact: true }).fill('60000');
  await developer.getByLabel('Planned start', { exact: true }).fill('2026-01-01');
  await developer.getByLabel('Forecast start', { exact: true }).fill('2026-04-01');
  await developer.getByText('Additional costs and forecast assumptions', { exact: true }).click();
  for (const [name, value] of [
    ['Annual bonus', '12000'], ['Monthly benefits', '100'], ['Employer cost %', '20'],
    ['Hiring cost per hire', '3000'], ['Hiring probability %', '50'], ['Forecast annual salary', '72000'],
  ]) await developer.getByRole('spinbutton', { name, exact: true }).fill(value);
  await developer.getByRole('combobox', { name: 'Office', exact: true }).selectOption('hq');
  await page.getByRole('button', { name: 'Calculate budget & forecast', exact: true }).click();
  await expect(page.locator('[data-staffing-total="budget"]')).toContainText('93,600.00');
  await expect(page.locator('[data-staffing-total="forecast"]')).toContainText('41,250.00');
  await expect(page.getByRole('table', { name: 'Monthly totals', exact: true }).locator('tbody tr')).toHaveCount(12);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved staffing plans', exact: true })).toHaveValue('plan-1');
  await expect(page.getByRole('combobox', { name: 'Revision', exact: true })).toBeEnabled();
  await developer.getByRole('spinbutton', { name: 'Annual salary', exact: true }).fill('72000');
  await page.getByRole('textbox', { name: 'Revision note', exact: true }).fill('Salary updated');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.locator('[data-staffing-total="budget"]')).toContainText('108,000.00');
  await page.getByRole('combobox', { name: 'Revision', exact: true }).selectOption('1');
  await expect(page.locator('[data-staffing-total="budget"]')).toContainText('93,600.00');
  await expect(developer.getByRole('spinbutton', { name: 'Annual salary', exact: true })).toBeDisabled();
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const downloaded = await pendingDownload;
  const csv = await readFile((await downloaded.path())!, 'utf8');
  expect(csv).toContain('"Developer"'); expect(csv).toContain('"13300.00"');
  expect(scenarios[0].version).toBe(2);
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved staffing plans', exact: true }).selectOption('plan-1');
  await expect(page.locator('[data-staffing-total="budget"]')).toContainText('108,000.00');
});

test('filters Open and Budgeted positions and isolates the selected company', async ({ page }) => {
  const { requests } = await setup(page);
  await page.getByRole('textbox', { name: /^Plan title/ }).fill('Filter plan');
  await page.getByRole('group', { name: 'Developer', exact: true }).getByRole('spinbutton', { name: 'Annual salary', exact: true }).fill('60000');
  await page.getByRole('group', { name: 'Planner', exact: true }).getByRole('spinbutton', { name: 'Annual salary', exact: true }).fill('120000');
  await page.getByRole('checkbox', { name: 'Include Open positions', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Calculate budget & forecast', exact: true }).click();
  await expect(page.locator('[data-staffing-total="budget"]')).toContainText('120,000.00');
  expect(requests[0].body.lines.map((line) => line.positionId)).toEqual(['planner']);
  await page.getByRole('checkbox', { name: 'Include Open positions', exact: true }).check();
  await page.getByRole('button', { name: 'Calculate budget & forecast', exact: true }).click();
  await expect(page.locator('[data-staffing-total="budget"]')).toContainText('180,000.00');
  await page.locator('header select').selectOption('second');
  await expect(page.getByRole('group', { name: 'Second role', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Developer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /^Plan title/ })).toHaveValue('');
});

test('budget readers can calculate scenarios but cannot save them', async ({ page }) => {
  await setup(page, false);
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: /^Plan title/ }).fill('What-if');
  await page.getByRole('button', { name: 'Calculate budget & forecast', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Staffing budget results', exact: true })).toBeVisible();
});
