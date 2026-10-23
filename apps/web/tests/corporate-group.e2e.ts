import { expect, test, type Page } from '@playwright/test';

interface Office {
  id: string; code: string; name: string; companyId: string; city: string | null; street: string | null;
  postalCode: string | null; countryCode: string | null; phone: string | null; email: string | null; isActive: boolean; isHQ: boolean;
}
interface Company {
  id: string; code: string; name: string; parentCompanyId: string | null; isActive: boolean; city: string | null;
  street: string | null; postalCode: string | null; countryCode: string | null; phone: string | null; email: string | null;
  legalName: string | null; legalForm: string | null; vatId: string | null; taxNumber: string | null; commercialRegister: string | null;
  website: string | null; defaultCurrency: string; defaultLocale: string; fiscalYearStart: number; offices: Office[];
}
interface Goal { id: string; companyId: string; title: string; year: number; description: string | null; category: string | null; targetValue: string | null; currentValue: string | null; unit: string | null; status: string }
interface Announcement { id: string; companyId: string | null; title: string; content: string; priority: string; publishAt: string }

async function setup(page: Page, isSystemAdmin = true, empty = false) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'holding' }, version: 0 }));
  });
  const company = (id: string, code: string, name: string): Company => ({
    id, code, name, parentCompanyId: null, isActive: true, city: 'Berlin', street: null, postalCode: null, countryCode: 'DE', phone: null, email: null,
    legalName: null, legalForm: null, vatId: null, taxNumber: null, commercialRegister: null, website: null, defaultCurrency: 'EUR', defaultLocale: 'de', fiscalYearStart: 1, offices: [],
  });
  const companies = empty ? [] : [company('holding', 'HOLD', 'Holding'), company('second', 'SECOND', 'Second company')];
  const goals: Goal[] = [{ id: 'initial-goal', companyId: 'holding', title: 'Initial goal', year: 2026, description: 'Goal details', category: 'FINANCIAL', targetValue: '100', currentValue: '25', unit: '%', status: 'ON_TRACK' }];
  const announcements: Announcement[] = [{ id: 'initial-announcement', companyId: 'holding', title: 'Initial notice', content: 'Announcement details', priority: 'NORMAL', publishAt: '2026-01-01T12:00:00Z' }];
  const mutations: { path: string; method: string; companyId: string; body: unknown }[] = [];
  let nextId = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    const scope = request.headers()['x-company-id'];
    if (path === '/records/catalog') return route.fulfill({ json: [] });
    if (method !== 'GET') mutations.push({ path, method, companyId: scope, body: request.postData() ? request.postDataJSON() : null });
    // cookie session model: the SPA asks /auth/state before rendering protected routes
    if (path === '/auth/state') return route.fulfill({ json: { state: 'AUTHENTICATED', csrfToken: 'test-csrf' } });
    if (path === '/auth/me') return route.fulfill({ json: { id: 'admin', email: 'admin@example.com', firstName: 'Test', lastName: 'Admin', isSystemAdmin,
      permissions: ['corporate.goals.read', 'admin.masterdata.read'],
      memberships: companies.filter((row) => row.isActive).map((row, index) => ({ isDefault: index === 0, company: { id: row.id, code: row.code, name: row.name } })),
    } });
    if (path === '/master/countries') return route.fulfill({ json: [{ code: 'DE', name: 'Germany', nameDe: 'Deutschland' }] });
    if (path === '/master/currencies') return route.fulfill({ json: [{ code: 'EUR' }, { code: 'USD' }] });
    if (path === '/group/overview') {
      const active = companies.filter((row) => row.isActive);
      return route.fulfill({ json: { year: 2026, companies: active.map((row) => ({ ...row, currency: row.defaultCurrency, isParent: !row.parentCompanyId, fxRateToEUR: 1,
        headcount: 0, activeClients: 0, revenueYtd: 0, revenueYtdEUR: 0, openItems: 0, openItemsEUR: 0, backlog: 0, backlogEUR: 0, pipelineWeightedEUR: 0, revenueByMonthEUR: Array(12).fill(0) })),
        totals: { companies: active.length, offices: active.reduce((count, row) => count + row.offices.filter((office) => office.isActive).length, 0), headcount: 0, activeClients: 0, revenueYtdEUR: 0, openItemsEUR: 0, backlogEUR: 0, pipelineWeightedEUR: 0 },
      } });
    }
    if (path === '/master/companies' && method === 'GET') return route.fulfill({ json: companies });
    if (path === '/master/companies' && method === 'POST') {
      const body = request.postDataJSON();
      const row = Object.assign(company(`company-${++nextId}`, body.code, body.name), body); companies.push(row);
      return route.fulfill({ json: row });
    }
    const officeMatch = /^\/master\/companies\/([^/]+)\/offices(?:\/([^/]+))?$/.exec(path);
    if (officeMatch) {
      const parent = companies.find((row) => row.id === officeMatch[1])!;
      const id = officeMatch[2];
      if (method === 'POST') { const row = { id: `office-${++nextId}`, companyId: parent.id, ...request.postDataJSON() }; parent.offices.push(row); return route.fulfill({ json: row }); }
      const row = parent.offices.find((office) => office.id === id)!;
      if (method === 'PATCH') { Object.assign(row, request.postDataJSON()); return route.fulfill({ json: row }); }
      if (method === 'DELETE') { parent.offices.splice(parent.offices.indexOf(row), 1); return route.fulfill({ status: 204 }); }
      return route.fulfill({ json: row });
    }
    const companyMatch = /^\/master\/companies\/([^/]+)$/.exec(path);
    if (companyMatch) {
      const row = companies.find((item) => item.id === companyMatch[1])!;
      if (method === 'PATCH') { Object.assign(row, request.postDataJSON()); return route.fulfill({ json: row }); }
      if (method === 'DELETE') {
        if (row.id === 'holding') return route.fulfill({ status: 409, json: { message: 'Company has business records. Deactivate it instead of deleting it.' } });
        companies.splice(companies.indexOf(row), 1); return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: row });
    }
    const corporateMatch = /^\/corporate\/(goals|announcements)(?:\/([^/]+))?$/.exec(path);
    if (corporateMatch) {
      const collection = corporateMatch[1] === 'goals' ? goals : announcements;
      const id = corporateMatch[2];
      if (method === 'GET') return route.fulfill({ json: id ? collection.find((row) => row.id === id) : collection.filter((row) => row.companyId === scope || row.companyId === null) });
      if (method === 'POST') {
        const body = request.postDataJSON(); const row = { id: `record-${++nextId}`, companyId: scope, publishAt: '2026-01-01T12:00:00Z', ...body };
        if (corporateMatch[1] === 'goals') goals.push(row); else announcements.push(row);
        return route.fulfill({ json: row });
      }
      const row = collection.find((record) => record.id === id)!;
      if (method === 'PATCH') { Object.assign(row, request.postDataJSON()); return route.fulfill({ json: row }); }
      if (method === 'DELETE') { collection.splice(collection.indexOf(row), 1); return route.fulfill({ status: 204 }); }
    }
    return route.fulfill({ json: { count: 0 } });
  });
  return { companies, goals, announcements, mutations };
}

test('an empty workspace clears stale company selection and lets its admin create the first real company', async ({ page }) => {
  const { companies, mutations } = await setup(page, true, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your workspace is empty', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('octa-bms-auth')!).state.companyId)).toBeNull();
  await page.getByRole('link', { name: 'Set up my company', exact: true }).click();
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Code/ }).fill('REAL');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('My real company');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(companies).toHaveLength(1);
  expect(mutations.find((row) => row.path === '/master/companies' && row.method === 'POST')?.companyId).toBeUndefined();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('octa-bms-auth')!).state.companyId)).toBe(companies[0].id);
  await page.goto('/corporate');
  await expect(page.getByRole('heading', { name: 'Company Goals', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your workspace is empty', exact: true })).toHaveCount(0);
});

test('Corporate goals support create, view, edit including cleared optional values, and confirmed deletion', async ({ page }) => {
  const { goals } = await setup(page); await page.goto('/corporate');
  await page.getByRole('heading', { name: 'Company Goals', exact: true }).locator('..').getByRole('button', { name: 'New', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Title/ }).fill('New target');
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Create and edit target');
  await dialog.getByRole('spinbutton', { name: 'Target', exact: true }).fill('1250.50');
  await dialog.getByRole('spinbutton', { name: 'Current', exact: true }).fill('100');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'New target', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Create and edit target'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit New target', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Title/ }).fill('Updated target');
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('');
  await dialog.getByRole('spinbutton', { name: 'Current', exact: true }).fill('');
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('AT_RISK');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Updated target', exact: true })).toBeVisible();
  expect(goals.find((row) => row.title === 'Updated target')).toMatchObject({ currentValue: null, description: null, status: 'AT_RISK' });
  await page.getByRole('button', { name: 'Delete Updated target', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Updated target', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Updated target', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Updated target', exact: true })).toHaveCount(0);
});

test('Corporate announcements support create, read, edit priority and content, and delete', async ({ page }) => {
  const { announcements } = await setup(page); await page.goto('/corporate');
  await page.getByRole('heading', { name: 'Announcements', exact: true }).locator('..').getByRole('button', { name: 'New', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Title/ }).fill('New notice');
  await dialog.getByRole('textbox', { name: /^Content/ }).fill('Please review the new process');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'New notice', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Please review the new process'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit New notice', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Content/ }).fill('Updated process');
  await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('URGENT');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(announcements.find((row) => row.title === 'New notice')).toMatchObject({ content: 'Updated process', priority: 'URGENT' });
  await page.getByRole('button', { name: 'Delete New notice', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New notice', exact: true })).toHaveCount(0);
});

test('Group companies and offices support create, view, edit, and confirmed deletion', async ({ page }) => {
  const { companies } = await setup(page); await page.goto('/group');
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Code/ }).fill('TEST');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Test company');
  await dialog.getByRole('combobox', { name: 'Parent company', exact: true }).selectOption('holding');
  await dialog.getByRole('combobox', { name: 'Country', exact: true }).selectOption('DE');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Test company', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New office', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Code/ }).fill('BRANCH');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Branch');
  await dialog.getByRole('textbox', { name: 'City', exact: true }).fill('Hamburg');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'View Branch', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Hamburg'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit Branch', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'City', exact: true }).fill('Bremen');
  await dialog.getByRole('checkbox', { name: 'Headquarters', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(companies.find((row) => row.code === 'TEST')!.offices[0]).toMatchObject({ city: 'Bremen', isHQ: true });
  await page.getByRole('button', { name: 'Edit Test company', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Updated company');
  await dialog.getByRole('textbox', { name: 'Legal name', exact: true }).fill('Updated GmbH');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Updated company', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Branch', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Branch', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Updated company', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Updated company', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Updated company', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Updated company', exact: true })).toHaveCount(0);
});

test('Group keeps blocked deletions reviewable and resets company scope when the active company is deactivated', async ({ page }) => {
  const { companies } = await setup(page); await page.goto('/group');
  await page.getByRole('button', { name: 'Delete Holding', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Deactivate it instead');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Holding', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Active', exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(companies[0].isActive).toBe(false);
  const scope = await page.evaluate(() => JSON.parse(localStorage.getItem('octa-bms-auth')!).state.companyId);
  expect(scope).toBe('second');
  await expect(page.getByRole('button', { name: 'Edit Holding', exact: true })).toBeVisible();
});

test('read-only users can view corporate and group records without mutation controls', async ({ page }) => {
  await setup(page, false); await page.goto('/corporate');
  await expect(page.getByRole('button', { name: 'Initial goal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Edit|Delete) / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Initial goal', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Goal details');
  await page.keyboard.press('Escape'); await page.goto('/group');
  await page.getByRole('button', { name: 'View Holding', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Holding', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New company', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Edit|Delete) / })).toHaveCount(0);
});
