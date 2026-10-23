import { expect, test, type Page } from '@playwright/test';
import type { CalendarItem } from '../src/features/company-calendar/types';

async function setup(page: Page, enabled = true) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test', refreshToken: 'test', companyId: 'company' }, version: 0 }));
  });
  const rows: CalendarItem[] = []; const writes: { path: string; body: Record<string, unknown>; company: string }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', ''); const method = request.method();
    if (path === '/auth/me') return route.fulfill({ json: { id: 'owner', email: 'owner@example.com', firstName: 'Test', lastName: 'Owner', isSystemAdmin: true, permissions: [], memberships: [{ isDefault: true, company: { id: 'company', code: 'TEST', name: 'Calendar test company' } }] } });
    if (path === '/business-calendar/capabilities') return route.fulfill({ json: { enabled, domains: ['OPERATIONS', 'FINANCE', 'MEETING'], entityTypes: ['partner'], microsoft: { connected: false }, ai: { connected: false } } });
    if (path === '/business-calendar/entities') return route.fulfill({ json: [{ id: 'partner', label: 'Actual test business partner' }] });
    if (path === '/business-calendar/members') return route.fulfill({ json: [{ id: 'owner', firstName: 'Test', lastName: 'Owner' }] });
    if (method !== 'GET' && path.startsWith('/business-calendar')) writes.push({ path, body: request.postDataJSON(), company: request.headers()['x-company-id'] });
    if (path === '/business-calendar/items' && method === 'POST') {
      const body = request.postDataJSON();
      const row = { id: `item-${rows.length}`, companyId: 'company', createdById: 'owner', status: 'OPEN', version: 1, sourceKind: 'MANUAL', evidence: [], grants: [], checklist: [], recurrenceFrequency: null, owner: { id: 'owner', firstName: 'Test', lastName: 'Owner' }, canEdit: true, attention: { score: 25, reasons: ['DUE_SOON'], overdue: false }, ...body } as CalendarItem;
      rows.push(row); return route.fulfill({ json: row });
    }
    if (path === '/business-calendar/items' && method === 'GET') {
      const search = new URL(request.url()).searchParams.get('search') ?? '';
      const data = rows.filter((r) => r.title.includes(search)); return route.fulfill({ json: { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } } });
    }
    if (path === '/business-calendar/horizon') return route.fulfill({ json: { items: rows.filter((r) => r.status !== 'COMPLETED'), total: rows.length, truncated: false, summary: { critical: 0, overdue: 0, awaiting: 0, missingOwner: 0 } } });
    const match = /^\/business-calendar\/items\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (match) {
      const row = rows.find((r) => r.id === match[1]); if (!row) return route.fulfill({ status: 404, json: { message: 'Not found' } });
      if (match[2] === 'history') return route.fulfill({ json: [{ id: 'history', version: row.version, action: row.status === 'COMPLETED' ? 'COMPLETED' : 'CREATED', createdAt: '2026-10-12T10:00:00Z', changes: { before: null, after: row } }] });
      if (method === 'PATCH') { Object.assign(row, request.postDataJSON(), { version: row.version + 1 }); return route.fulfill({ json: { id: row.id, version: row.version } }); }
      if (match[2] === 'evidence') { const body = request.postDataJSON(); row.evidence.push({ id: 'evidence', title: body.title, url: body.url }); row.version++; return route.fulfill({ json: row }); }
      if (match[2] === 'complete') {
        if (!row.evidence.length || row.checklist.some((c) => !c.done)) return route.fulfill({ status: 400, json: { message: 'Complete preparation and add required evidence first' } });
        row.status = 'COMPLETED'; row.version++; return route.fulfill({ json: row });
      }
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: { count: 0 } });
  });
  return { rows, writes };
}

test('creates an obligation with distinct dates, prepares evidence, completes and reviews history', async ({ page }) => {
  const { rows, writes } = await setup(page);
  await page.goto('/company-calendar?date=2026-10-12');
  await expect(page.getByRole('heading', { name: 'Company Calendar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add business date', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Title/ }).fill('Prepare tax documents');
  await dialog.getByLabel('External hard deadline').fill('2026-10-16');
  await dialog.getByLabel('Internal target').fill('2026-10-14');
  await dialog.getByLabel('New checklist step').fill('Compile supporting documents');
  await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
  await dialog.getByLabel('Evidence is required for completion').check();
  await dialog.getByRole('combobox', { name: 'Linked business entity', exact: true }).selectOption('partner');
  await dialog.getByRole('combobox', { name: 'Business entity reference', exact: true }).selectOption('partner');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(rows[0]).toMatchObject({ hardDueDate: '2026-10-16', internalTargetDate: '2026-10-14', ownerUserId: 'owner', completionEvidenceRequired: true, businessEntityType: 'partner', businessEntityId: 'partner' });
  expect(writes[0].company).toBe('company'); expect(writes[0].body).not.toHaveProperty('companyId');
  await page.getByRole('button', { name: /Prepare tax documents/ }).first().click();
  await dialog.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Complete preparation');
  await dialog.getByRole('button', { name: 'Preparation & Evidence', exact: true }).click();
  await dialog.getByLabel('Compile supporting documents').check();
  await expect.poll(() => rows[0].checklist[0].done).toBe(true);
  await dialog.getByLabel('Evidence title').fill('Reviewed records');
  await dialog.getByLabel('Evidence link (HTTPS)').fill('https://example.com/records');
  await dialog.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'Reviewed records' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await dialog.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect.poll(() => rows[0].status).toBe('COMPLETED');
  await dialog.getByRole('button', { name: 'History', exact: true }).click();
  await expect(dialog.getByText('Completed · Version 4')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Obligations & Commitments', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Prepare tax documents');
});

test('calendar views, filters, saved views and mobile modal keyboard focus work', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/company-calendar?date=2026-10-12&view=calendar');
  await page.getByLabel('Calendar mode').selectOption('workweek');
  await expect(page.locator('section[aria-label]')).toHaveCount(5);
  await page.getByLabel('Calendar mode').selectOption('day');
  await expect(page.locator('section[aria-label]')).toHaveCount(1);
  await page.getByLabel('Calendar mode').selectOption('year');
  await expect(page.getByRole('button', { name: /January/ })).toBeVisible();
  await page.getByRole('button', { name: 'Business Timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Business domain', exact: true }).selectOption('FINANCE');
  await page.getByLabel('Save filters as').fill('Finance');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByRole('combobox', { name: 'Business domain', exact: true }).selectOption('');
  await page.getByRole('combobox', { name: 'Personal saved views', exact: true }).selectOption({ label: 'Finance' });
  await expect(page.getByRole('combobox', { name: 'Business domain', exact: true })).toHaveValue('FINANCE');
  await page.getByRole('button', { name: 'Add business date', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /^Title/ })).toBeFocused();
  for (let i = 0; i < 45; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Integrations & Settings', exact: true }).click();
  await expect(page.getByText('Not connected / not configured', { exact: true })).toHaveCount(4);
});

test('disabled calendar prevents creation', async ({ page }) => {
  await setup(page, false); await page.goto('/company-calendar');
  await expect(page.getByRole('status')).toContainText('Company Calendar is disabled');
  await expect(page.getByRole('button', { name: 'Add business date', exact: true })).toBeDisabled();
});
