import { expect, test, type Page, type Route } from '@playwright/test';
import { positionStatus, type OrgChartSnapshot, type OrgChartVersion } from '../src/pages/org-chart';

async function setup(page: Page, mode: 'normal' | 'empty' | 'error' | 'positions-error' = 'normal', editor = false) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: {
      accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'first',
    }, version: 0 }));
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const second = request.headers()['x-company-id'] === 'second';
    if (path === '/hr/org-chart/versions') return route.fulfill({ json: [] });
    if (path === '/auth/me') return route.fulfill({ json: {
      id: 'member', firstName: 'HR', lastName: 'Member', email: 'hr@example.com', isSystemAdmin: false,
      permissions: ['hr.employees.read', 'hr.recruitment.read', ...(editor ? ['hr.employees.update', 'hr.recruitment.create'] : [])], memberships: [
        { isDefault: true, company: { id: 'first', code: 'FIRST', name: 'First company' } },
        { isDefault: false, company: { id: 'second', code: 'SECOND', name: 'Second company' } },
      ],
    } });
    if (path === '/master/departments') {
      if (mode === 'error') return route.fulfill({ status: 500, json: { message: 'Departments unavailable' } });
      return route.fulfill({ json: mode === 'empty' ? [] : second
        ? [{ id: 'second-dept', code: 'SECOND', name: 'Second department', parentId: null }]
        : [
          { id: 'engineering', code: 'ENG', name: 'Engineering', parentId: null, managerId: 'manager' },
          { id: 'design', code: 'DES', name: 'Design', parentId: 'engineering' },
          { id: 'empty', code: 'EMPTY', name: 'Empty department', parentId: 'engineering' },
        ] });
    }
    if (path === '/hr/employees/org-chart/positions') {
      if (mode === 'positions-error') return route.fulfill({ status: 500, json: { message: 'Positions unavailable' } });
      return route.fulfill({ json: mode === 'empty' ? [] : second ? [
        { id: 'second-position', code: 'SECOND', name: 'Second role', level: 'SENIOR' },
      ] : [
        { id: 'director', code: 'DIR', name: 'Director', level: 'DIRECTOR' },
        { id: 'designer', code: 'DES', name: 'Designer', level: 'PROFESSIONAL' },
        { id: 'coordinator', code: 'COORD', name: 'Coordinator', level: 'PROFESSIONAL' },
        { id: 'vacant', code: 'PM', name: 'Project Manager', level: 'LEAD', department: { id: 'engineering', name: 'Engineering' } },
        { id: 'global-vacant', code: 'GLOBAL', name: 'Shared specialist', level: 'SENIOR' },
      ] });
    }
    if (path === '/hr/employees/org-chart') return route.fulfill({ json: mode === 'empty' ? [] : second ? [
      { id: 'second-employee', firstName: 'Second', lastName: 'Employee', managerId: null,
        position: { id: 'second-position', code: 'SECOND', name: 'Second role', level: 'SENIOR' },
        department: { id: 'second-dept', name: 'Second department' } },
    ] : [
      { id: 'manager', firstName: 'Anna', lastName: 'Manager', managerId: null, position: { id: 'director', code: 'DIR', name: 'Director', level: 'DIRECTOR' },
        department: { id: 'engineering', name: 'Engineering' } },
      { id: 'report', firstName: 'Ben', lastName: 'Designer', managerId: 'manager', position: { id: 'designer', code: 'DES', name: 'Designer', level: 'PROFESSIONAL' },
        department: { id: 'design', name: 'Design' } },
      { id: 'unassigned', firstName: 'Cara', lastName: 'Unassigned', managerId: null, department: null },
      { id: 'assistant', firstName: 'Dan', lastName: 'Coordinator', managerId: 'manager',
        position: { id: 'coordinator', code: 'COORD', name: 'Coordinator', level: 'PROFESSIONAL' },
        department: { id: 'engineering', name: 'Engineering' } },
    ] });
    return route.fulfill({ json: { count: 0 } });
  });
  await page.goto('/hr/org-chart');
}

test('merged chart includes department hierarchy, positions, employees, and empty departments for an HR member', async ({ page }) => {
  await setup(page);
  const engineering = page.locator('li[data-department-id="engineering"]');
  await expect(engineering.locator(':scope > .card')).toContainText('Engineering');
  await expect(engineering.locator(':scope > .card')).toContainText('2 employees');
  const departmentManager = engineering.locator(':scope > ul > li[data-position-node="employee:manager"]');
  await expect(engineering.locator(':scope > ul > li')).toHaveCount(1);
  await expect(departmentManager.locator(':scope > .card')).toContainText('Director');
  await expect(departmentManager.locator(':scope > ul > li[data-department-id="design"]')).toContainText('Ben Designer');
  await expect(departmentManager.locator(':scope > ul > li[data-department-id="empty"]')).toContainText('0 employees');
  await expect(engineering).toContainText('Anna Manager');
  await expect(page.locator('.org')).toContainText('No department assigned');
  await expect(page.locator('.org')).toContainText('Cara Unassigned');
  await page.getByRole('button', { name: 'Employee reporting', exact: true }).click();
  await expect(page.locator('li[data-department-id]')).toHaveCount(0);
  const manager = page.locator('.org li').filter({ has: page.locator(':scope > .card', { hasText: 'Anna Manager' }) });
  await expect(manager.locator(':scope > ul')).toContainText('Ben Designer');
  await page.getByRole('button', { name: 'Departments & positions', exact: true }).click();
  await expect(page.locator('li[data-department-id]')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Positions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Departments', exact: true })).toHaveCount(0);
});

async function setupStaffing(page: Page, editor = true) {
  await setup(page, 'normal', editor);
  const department = { id: 'adm', code: 'ADM', name: 'Business Administration', parentId: null, managerId: 'md' };
  const live: OrgChartSnapshot = {
    schemaVersion: 1, departments: [department],
    positions: [
      { id: 'director', code: 'MD', name: 'Managing Director', status: 'FILLED', department },
      { id: 'developer', code: 'DEV', name: 'Developer', status: 'OPEN', department },
      { id: 'planner', code: 'PLAN', name: 'Planner', status: 'BUDGETED', department },
    ],
    employees: [{ id: 'md', firstName: 'Alex', lastName: 'Director', managerId: null,
      position: { id: 'director', name: 'Managing Director' }, department }],
  };
  const second: OrgChartSnapshot = { schemaVersion: 1, departments: [{ id: 'second', name: 'Second department' }],
    employees: [], positions: [{ id: 'second-role', name: 'Second role', status: 'OPEN', department: { id: 'second', name: 'Second department' } }] };
  const versions: OrgChartVersion[] = [];
  const addVersion = (title: string, note: string | null = null) => {
    const version: OrgChartVersion = { id: `v${versions.length + 1}`, version: versions.length + 1, title, note,
      createdAt: '2026-10-12T10:00:00Z', createdBy: { firstName: 'HR', lastName: 'Editor' }, snapshot: structuredClone(live) };
    versions.push(version); return version;
  };
  addVersion('Initial chart');
  const scope = (route: Route) => route.request().headers()['x-company-id'] === 'second' ? second : live;
  await page.route('**/api/v1/master/departments', (route) => route.fulfill({ json: scope(route).departments }));
  await page.route('**/api/v1/master/offices', (route) => route.fulfill({ json: route.request().headers()['x-company-id'] === 'second'
    ? [{ id: 'second-office', code: 'SECOND', name: 'Second office', city: 'Hamburg' }]
    : [{ id: 'hq', code: 'HQ', name: 'Head office', city: 'Berlin' }] }));
  await page.route('**/api/v1/hr/employees/org-chart', (route) => route.fulfill({ json: scope(route).employees }));
  await page.route('**/api/v1/hr/employees/org-chart/positions', (route) => route.fulfill({ json: scope(route).positions }));
  await page.route('**/api/v1/hr/recruitment/open-positions', (route) => {
    const snapshot = scope(route);
    return route.fulfill({ json: snapshot.positions.filter((position) => positionStatus(position, snapshot.employees) === 'OPEN') });
  });
  const openings = [{ id: 'existing', title: 'Existing opening', departmentName: null as string | null, officeName: null as string | null,
    status: 'OPEN', companyId: 'first', _count: { applicants: 0 } }];
  await page.route('**/api/v1/hr/job-openings', (route) => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      const opening = { ...data, departmentName: data.departmentId ? scope(route).departments.find((row) => row.id === data.departmentId)?.name ?? null : null,
        officeName: data.officeId === 'hq' ? 'Head office' : null,
        companyId: route.request().headers()['x-company-id'], id: `job-${openings.length}`, status: 'OPEN', _count: { applicants: 0 } };
      openings.push(opening); return route.fulfill({ json: opening });
    }
    return route.fulfill({ json: openings.filter((opening) => opening.companyId === route.request().headers()['x-company-id']) });
  });
  await page.route('**/api/v1/hr/applicants/board', (route) => route.fulfill({ json:
    ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'].map((stage) => ({ stage, items: [] })),
  }));
  await page.route('**/api/v1/hr/org-chart/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/hr/org-chart', '');
    const secondCompany = request.headers()['x-company-id'] === 'second';
    if (path === '/versions' && request.method() === 'GET') return route.fulfill({ json: secondCompany ? [] : [...versions].reverse().map(({ snapshot: _snapshot, ...version }) => version) });
    if (path === '/versions' && request.method() === 'POST') {
      const body = request.postDataJSON();
      return route.fulfill({ json: addVersion(body.title, body.note ?? null) });
    }
    if (path.startsWith('/versions/')) {
      const version = !secondCompany && versions.find((row) => row.id === path.split('/')[2]);
      return version ? route.fulfill({ json: version }) : route.fulfill({ status: 404, json: { message: 'Version not found' } });
    }
    if (request.method() === 'PATCH' && path.startsWith('/positions/')) {
      const position = live.positions.find((row) => row.id === path.split('/')[2])!;
      addVersion('Before staffing change'); position.status = request.postDataJSON().status; addVersion('Staffing change');
      return route.fulfill({ json: { id: position.id, status: position.status } });
    }
    return route.fulfill({ status: 404, json: { message: 'Not found' } });
  });
  await page.reload();
  return { live, versions, openings };
}

test('staffing statuses can be edited and saved versions remain frozen and comparable', async ({ page }) => {
  const { live, versions } = await setupStaffing(page);
  const director = page.locator('li[data-position-node="employee:md"] > .card');
  await expect(director).toContainText('Filled');
  await expect(director.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Status for Planner' })).toHaveValue('BUDGETED');
  await page.getByRole('combobox', { name: 'Status for Developer' }).selectOption('BUDGETED');
  await expect(page.getByRole('combobox', { name: 'Status for Developer' })).toHaveValue('BUDGETED');
  expect(versions).toHaveLength(3);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Version title' }).fill('Approved staffing');
  await dialog.getByRole('textbox', { name: 'Change note' }).fill('Budget approved');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(versions).toHaveLength(4);
  live.employees[0].firstName = 'Updated';
  await page.reload();
  await expect(page.locator('.org')).toContainText('Updated Director');
  await page.getByRole('combobox', { name: 'Org chart versions' }).selectOption('v1');
  await expect(page.locator('li[data-position-node="position:developer"] > .card')).toContainText('Open');
  await expect(page.locator('.org')).toContainText('Alex Director');
  await expect(page.locator('.org')).not.toContainText('Updated Director');
  await page.getByRole('button', { name: 'Employee reporting', exact: true }).click();
  await expect(page.locator('.org')).toContainText('Alex Director');
  await expect(page.locator('.org')).not.toContainText('Updated Director');
  await page.getByRole('button', { name: 'Departments & positions', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Status for/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Compare with current chart', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Developer');
  await expect(page.getByRole('dialog')).toContainText('Status: Open');
  await expect(page.getByRole('dialog')).toContainText('Status: Budgeted');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Org chart versions' }).selectOption('');
  await expect(page.getByRole('combobox', { name: 'Status for Developer' })).toHaveValue('BUDGETED');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Org chart versions' }).locator('option')).toHaveCount(5);
});

test('readers can inspect versions and switching company clears a selected historical chart', async ({ page }) => {
  await setupStaffing(page, false);
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Status for/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Org chart versions' }).selectOption('v1');
  await expect(page.getByText(/Saved version · read-only/)).toBeVisible();
  await page.locator('header select').selectOption('second');
  await expect(page.getByRole('combobox', { name: 'Org chart versions' })).toHaveValue('');
  await expect(page.locator('.org')).toContainText('Second department');
  await expect(page.locator('.org')).not.toContainText('Alex Director');
});

test('a rejected staffing change keeps its original state and shows the error', async ({ page }) => {
  const { versions } = await setupStaffing(page);
  await page.route('**/api/v1/hr/org-chart/positions/developer/status', (route) => route.fulfill({
    status: 409, json: { message: 'This position was filled while you were editing' },
  }));
  await page.getByRole('combobox', { name: 'Status for Developer' }).selectOption('BUDGETED');
  await expect(page.getByRole('alert')).toHaveText('This position was filled while you were editing');
  await expect(page.getByRole('combobox', { name: 'Status for Developer' })).toHaveValue('OPEN');
  expect(versions).toHaveLength(1);
});

test('Recruitment lists Open positions and prefills a job opening with the position and department', async ({ page }) => {
  const { openings } = await setupStaffing(page);
  await page.getByRole('link', { name: 'Recruitment', exact: true }).click();
  const openPositions = page.getByRole('region', { name: 'Open positions', exact: true });
  await expect(openPositions).toContainText('Developer');
  await expect(openPositions).toContainText('Business Administration');
  await expect(openPositions).not.toContainText('Planner');
  await expect(openPositions).not.toContainText('Managing Director');
  await expect(page.getByText('Existing opening', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New opening for Developer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /^Title/ })).toHaveValue('Developer');
  await expect(dialog.getByRole('combobox', { name: 'Department', exact: true })).toHaveValue('adm');
  await dialog.getByRole('combobox', { name: 'Office', exact: true }).selectOption('hq');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(openings).toHaveLength(2);
  expect(openings[1]).toMatchObject({ title: 'Developer', departmentName: 'Business Administration', officeName: 'Head office', companyId: 'first' });
  await page.getByRole('button', { name: 'New applicant', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('combobox').locator('option', { hasText: 'Developer' })).toHaveCount(1);
});

test('Recruitment refreshes Open positions when they become Budgeted, reopen, or are Filled', async ({ page }) => {
  const { live } = await setupStaffing(page);
  await page.getByRole('link', { name: 'Recruitment', exact: true }).click();
  await expect(page.locator('[data-open-position-id="developer"]')).toBeVisible();
  await page.getByRole('link', { name: 'Org Chart', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status for Developer' }).selectOption('BUDGETED');
  await expect(page.getByRole('combobox', { name: 'Status for Developer' })).toHaveValue('BUDGETED');
  await page.getByRole('link', { name: 'Recruitment', exact: true }).click();
  await expect(page.locator('[data-open-position-id="developer"]')).toHaveCount(0);
  await expect(page.getByText('No open positions in the current org chart.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Org Chart', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status for Developer' }).selectOption('OPEN');
  await expect(page.getByRole('combobox', { name: 'Status for Developer' })).toHaveValue('OPEN');
  await page.getByRole('link', { name: 'Recruitment', exact: true }).click();
  await expect(page.locator('[data-open-position-id="developer"]')).toBeVisible();
  live.employees.push({ id: 'hired', firstName: 'New', lastName: 'Developer', managerId: 'md', position: live.positions[1], department: live.departments[0] });
  await page.getByRole('link', { name: 'Org Chart', exact: true }).click();
  await page.getByRole('link', { name: 'Recruitment', exact: true }).click();
  await expect(page.locator('[data-open-position-id="developer"]')).toHaveCount(0);
});

test('Recruitment readers see Open positions for their selected company', async ({ page }) => {
  await setupStaffing(page, false);
  await page.getByRole('link', { name: 'Recruitment', exact: true }).click();
  await expect(page.locator('[data-open-position-id="developer"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New opening for Developer', exact: true })).toHaveCount(0);
  await page.locator('header select').selectOption('second');
  await expect(page.locator('[data-open-position-id="second-role"]')).toBeVisible();
  await expect(page.locator('[data-open-position-id="developer"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Open positions', exact: true })).toContainText('Second department');
});

test('switching companies replaces department and employee data', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.org')).toContainText('Engineering');
  await page.locator('header select').selectOption('second');
  await expect(page.locator('.org')).toContainText('Second department');
  await expect(page.locator('.org')).toContainText('Second Employee');
  await expect(page.locator('.org')).not.toContainText('Anna Manager');
  await expect(page.locator('.org')).not.toContainText('Engineering');
});

test('an empty chart has an explicit empty state', async ({ page }) => {
  await setup(page, 'empty');
  await expect(page.getByText('No results', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Employee reporting', exact: true }).click();
  await expect(page.getByText('No results', { exact: true })).toBeVisible();
});

test('positions sit inside their departments with reporting lines, unfilled roles, and unassigned employees', async ({ page }) => {
  await setup(page);
  const engineering = page.locator('li[data-department-id="engineering"]');
  const director = engineering.locator(':scope > ul > li[data-position-node="employee:manager"]');
  await expect(director.locator(':scope > .card')).toContainText('Director');
  await expect(director.locator(':scope > .card')).toContainText('Anna Manager');
  await expect(director.locator(':scope > .card')).toContainText('Engineering');
  await expect(director.locator(':scope > ul > li[data-position-node="employee:assistant"]')).toContainText('Dan Coordinator');
  const designer = page.locator('li[data-department-id="design"]').locator(':scope > ul > li[data-position-node="employee:report"]');
  await expect(designer).toContainText('Ben Designer');
  await expect(designer).toContainText('PROFESSIONAL');
  const vacant = director.locator(':scope > ul > li[data-position-node="position:vacant"]');
  await expect(vacant).toContainText('Project Manager');
  await expect(vacant).toContainText('Unfilled position');
  await expect(vacant).toContainText('Engineering');
  await expect(page.locator('li[data-position-node="employee:unassigned"]')).toContainText('No position assigned');
  await expect(page.locator('li[data-position-node="employee:unassigned"]')).toContainText('Cara Unassigned');
  const unassignedGroup = page.locator('.org > ul > li').filter({ has: page.locator(':scope > .card', { hasText: 'No department assigned' }) });
  await expect(unassignedGroup).toContainText('Shared specialist');
  await expect(unassignedGroup).toContainText('Cara Unassigned');
  await expect(page.locator('li[data-position-node]')).toHaveCount(6);
});

test('merged chart replaces departments, roles, and occupants when switching companies', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.org')).toContainText('Project Manager');
  await page.locator('header select').selectOption('second');
  await expect(page.locator('.org')).toContainText('Second role');
  await expect(page.locator('.org')).toContainText('Second Employee');
  await expect(page.locator('.org')).not.toContainText('Anna Manager');
  await expect(page.locator('.org')).not.toContainText('Project Manager');
  await expect(page.locator('li[data-position-node]')).toHaveCount(1);
});

test('position errors are visible while employee reporting remains usable', async ({ page }) => {
  await setup(page, 'positions-error');
  await expect(page.getByRole('alert')).toHaveText('Positions unavailable');
  await page.getByRole('button', { name: 'Employee reporting', exact: true }).click();
  await expect(page.locator('.org')).toContainText('Engineering');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('department errors are visible and employee reporting remains available', async ({ page }) => {
  await setup(page, 'error');
  await expect(page.getByRole('alert')).toHaveText('Departments unavailable');
  await page.getByRole('button', { name: 'Employee reporting', exact: true }).click();
  await expect(page.locator('.org')).toContainText('Anna Manager');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a department with only its manager has no empty connector branch', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/master/departments', (route) => route.fulfill({ json: [
    { id: 'administration', code: 'ADM', name: 'Business Administration', parentId: null, managerId: 'director' },
  ] }));
  await page.route('**/api/v1/hr/employees/org-chart/positions', (route) => route.fulfill({ json: [
    { id: 'md', code: 'MD', name: 'Managing Director', department: { id: 'administration', name: 'Business Administration' } },
  ] }));
  await page.route('**/api/v1/hr/employees/org-chart', (route) => route.fulfill({ json: [
    { id: 'director', firstName: 'Alex', lastName: 'Director', managerId: null,
      position: { id: 'md', code: 'MD', name: 'Managing Director' },
      department: { id: 'administration', name: 'Business Administration' } },
  ] }));
  await page.reload();
  const department = page.locator('li[data-department-id="administration"]');
  await expect(department.locator(':scope > .card')).toContainText('Business Administration');
  const director = department.locator(':scope > ul > li');
  await expect(director).toHaveCount(1);
  await expect(director.locator(':scope > .card')).toContainText('Managing Director');
  await expect(director.locator(':scope > ul')).toHaveCount(0);
});
