import { expect, test, type Page } from '@playwright/test';
import { RECORD_RESOURCES, recordFields } from '../../api/src/modules/records/record-catalog';

type Row = Record<string, unknown> & { _key: string; _label: string; companyId: string; deletedAt: string | null };
async function setup(page: Page, isSystemAdmin = true) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'company' }, version: 0 }));
  });
  const columns: Record<string, string[]> = { goals: ['title','year','status'], contacts: ['firstName','lastName','partnerId'], invoices: ['invoiceNumber','netAmount','grossAmount','status'], users: ['firstName','email','isActive'], payments: ['reference','amount','direction'] };
  const catalog = Object.entries(columns).map(([key, fields]) => {
    const def = RECORD_RESOURCES[key];
    return { key, module: def.module, name: { en: def.en, de: def.de }, fields: recordFields(def), columns: fields, native: def.native,
      createNative: !!def.createNative, companyScoped: key !== 'users', canArchive: key !== 'payments', deleteAction: key === 'payments' ? 'reverse' : 'delete' };
  });
  const make = (id: string, data: Record<string, unknown>): Row => ({ id, _key: id, _label: String(data.title ?? data.invoiceNumber ?? data.reference ?? `${data.firstName ?? ''} ${data.lastName ?? ''}`), companyId: 'company', deletedAt: null, createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z', ...data });
  const rows: Record<string, Row[]> = {
    goals: [make('sample', { title: 'Sample goal', year: 2026, category: 'FINANCIAL', targetValue: '100', currentValue: '20', unit: '%', status: 'ON_TRACK' }), make('blocked', { title: 'Linked goal', year: 2026, status: 'ON_TRACK' }), make('foreign', { title: 'Other company goal', year: 2026, companyId: 'other', status: 'ON_TRACK' })],
    contacts: [make('contact', { firstName: 'Sample', lastName: 'Contact', partnerId: 'partner', _references: { partnerId: 'Real client' } })],
    invoices: [make('invoice', { invoiceNumber: 'R-2026-00001', direction: 'OUTGOING', partnerId: 'partner', invoiceDate: '2026-10-12T00:00:00Z', dueDate: '2026-11-12T00:00:00Z', currencyCode: 'EUR', status: 'DRAFT', netAmount: '10', taxAmount: '1.9', grossAmount: '11.9', paidAmount: '0', dunningLevel: 0,
      lines: [{ description: 'Sample service', quantity: '1', unit: 'h', unitPrice: '10', taxCodeId: 'vat', _references: { taxCodeId: 'VAT 19%' } }], _references: { partnerId: 'Real client' } })],
    users: [], payments: [make('payment', { reference: 'Sample transfer', amount: '10', direction: 'IN' })],
  };
  const mutations: { method: string; path: string; companyId: string; data?: Record<string, unknown>; ids?: string[] }[] = [];
  const queries: string[] = []; let counter = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/api/v1', ''); const method = request.method(); const companyId = request.headers()['x-company-id'];
    if (method === 'GET') queries.push(path);
    // cookie session model: the SPA asks /auth/state before rendering protected routes
    if (path === '/auth/state') return route.fulfill({ json: { state: 'AUTHENTICATED', csrfToken: 'test-csrf' } });
    if (path === '/auth/me') return route.fulfill({ json: { id: 'admin', email: 'admin@example.com', firstName: 'Test', lastName: 'Admin', isSystemAdmin, permissions: [], memberships: [{ isDefault: true, company: { id: 'company', name: 'Holding', code: 'HOLD' } }, { isDefault: false, company: { id: 'other', name: 'Subsidiary', code: 'SUB' } }] } });
    if (path === '/records/catalog') return route.fulfill({ json: catalog });
    const lookup = /^\/records\/([^/]+)\/lookup\/(.+)$/.exec(path);
    if (lookup) return route.fulfill({ json: lookup[2] === 'partnerId' ? [{ value: 'partner', label: 'Real client' }] : lookup[2] === 'lines.taxCodeId' ? [{ value: 'vat', label: 'VAT 19%' }] : [] });
    const match = /^\/records\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (!match) return route.fulfill({ json: { count: 0, data: [], meta: { total: 0, totalPages: 0 } } });
    const key = match[1]; const action = match[2]; const collection = rows[key] ?? [];
    if (method === 'GET') {
      const filtered = collection.filter((row) => (key === 'users' || row.companyId === companyId) && (action === 'archived/list' ? !!row.deletedAt : !row.deletedAt) && row._label.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase()));
      return route.fulfill({ json: { data: filtered, meta: { total: filtered.length, totalPages: 1, page: 1, pageSize: 50 } } });
    }
    const body = request.postData() ? request.postDataJSON() : {};
    mutations.push({ method, path, companyId, ...structuredClone(body) });
    if (action?.endsWith('/restore')) { const row = collection.find((row) => row._key === action.split('/')[0])!; row.deletedAt = null; return route.fulfill({ json: { id: row._key } }); }
    if (method === 'DELETE' || action === 'bulk-delete') {
      const ids: string[] = method === 'DELETE' ? [action!] : body.ids;
      if (ids.includes('blocked')) return route.fulfill({ status: 409, json: { message: 'This record is still used by Tasks. Reassign or remove those records first.' } });
      for (const id of ids) collection.find((row) => row._key === id)!.deletedAt = '2026-10-12T10:00:00Z';
      return route.fulfill({ json: { deleted: ids.length } });
    }
    if (method === 'POST') { const row = make(`new-${++counter}`, { ...body.data, companyId }); collection.push(row); return route.fulfill({ json: { id: row._key } }); }
    const row = collection.find((row) => row._key === action)!; Object.assign(row, body.data); row._label = String(row.title ?? row.invoiceNumber ?? `${row.firstName ?? ''} ${row.lastName ?? ''}`);
    if (key === 'invoices') { row.netAmount = (body.data.lines as { quantity: string; unitPrice: string }[]).reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0).toFixed(2); row.grossAmount = (Number(row.netAmount) * 1.19).toFixed(2); (row.lines as Record<string, unknown>[]).forEach((line) => { line._references = { taxCodeId: 'VAT 19%' }; }); }
    return route.fulfill({ json: { id: row._key } });
  });
  await page.goto('/admin/data?resource=goals');
  return { rows, mutations, queries };
}

test('creates, views, edits, searches, deletes and restores a real company goal', async ({ page }) => {
  const { mutations } = await setup(page);
  await expect(page.getByRole('heading', { name: 'Data management' })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: false }).fill('Actual revenue goal');
  await dialog.getByLabel('Year', { exact: false }).fill('2027');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'View Actual revenue goal', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('2027');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Actual revenue goal', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByLabel('Title', { exact: false }).fill('Actual revenue target');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Actual revenue target', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search records', exact: true }).fill('Actual');
  await expect(page.getByRole('cell', { name: 'Sample goal', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Delete Actual revenue target', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('Deleted records', { exact: true }).check();
  await page.getByRole('button', { name: 'Restore Actual revenue target', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore Actual revenue target', exact: true })).not.toBeVisible();
  await page.getByLabel('Deleted records', { exact: true }).uncheck();
  await expect(page.getByRole('cell', { name: 'Actual revenue target', exact: true })).toBeVisible();
  expect(mutations.every((mutation) => mutation.companyId === 'company')).toBeTruthy();
  expect(mutations.find((mutation) => mutation.method === 'POST' && mutation.path === '/records/goals')!.data).not.toHaveProperty('companyId');
});

test('shows named relationship pickers and creates a contact with the selected client', async ({ page }) => {
  const { mutations } = await setup(page);
  await page.getByRole('combobox', { name: 'Record type', exact: true }).selectOption('contacts');
  await expect(page.getByRole('cell', { name: 'Real client', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name', { exact: false }).fill('Actual'); await dialog.getByLabel('Last name', { exact: false }).fill('Contact');
  await dialog.getByRole('combobox', { name: 'Partner', exact: true }).selectOption({ label: 'Real client' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).not.toBeVisible();
  expect(mutations.find((mutation) => mutation.path === '/records/contacts')!.data).toMatchObject({ firstName: 'Actual', lastName: 'Contact', partnerId: 'partner' });
});

test('edits invoice lines and leaves calculated totals and workflow state to the server', async ({ page }) => {
  const { mutations } = await setup(page);
  await expect(page.getByRole('heading', { name: 'Data management' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Record type', exact: true }).selectOption({ label: 'Invoices' });
  await page.getByRole('button', { name: /Edit/ }).filter({ hasText: 'Edit' }).first().click(); const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Gross amount')).toHaveCount(0); await expect(dialog.getByLabel('Status')).toHaveCount(0);
  await dialog.getByLabel('Description', { exact: false }).fill('Actual service');
  await dialog.getByLabel('Quantity', { exact: false }).fill('3'); await dialog.getByLabel('Unit price', { exact: false }).fill('10.01');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const data = mutations.find((mutation) => mutation.path === '/records/invoices/invoice')!.data!;
  expect(data).toHaveProperty('lines', [{ description: 'Actual service', quantity: '3', unit: 'h', unitPrice: '10.01', taxCodeId: 'vat', costCenterId: null, budgetCategory: null }]);
  expect(data).not.toHaveProperty('grossAmount'); expect(data).not.toHaveProperty('status');
  await expect(page.getByRole('cell', { name: '30.03', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^View / }).click(); await expect(page.getByRole('dialog')).toContainText('Actual service'); await expect(page.getByRole('dialog')).toContainText('VAT 19%');
});

test('keeps selected records visible when bulk deletion is rejected', async ({ page }) => {
  const { rows, mutations } = await setup(page);
  await page.getByRole('checkbox', { name: 'Select all records on this page' }).check();
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('still used by Tasks');
  expect(rows.goals.every((row) => !row.deletedAt)).toBeTruthy();
  expect(mutations[0]).toMatchObject({ path: '/records/goals/bulk-delete', ids: ['sample','blocked'] });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('cell', { name: 'Sample goal', exact: true })).toBeVisible();
});

test('clears the editor and selection when switching companies', async ({ page }) => {
  const { mutations } = await setup(page);
  await page.getByRole('button', { name: 'Edit Sample goal', exact: true }).click();
  await page.locator('header select').selectOption('other');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'Other company goal', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sample goal', exact: true })).not.toBeVisible();
  expect(mutations).toHaveLength(0);
});

test('routes payment creation to its allocation form and labels deletion as reversal', async ({ page }) => {
  await setup(page); await page.getByRole('combobox', { name: 'Record type', exact: true }).selectOption('payments');
  await expect(page.getByRole('link', { name: 'New', exact: true })).toHaveAttribute('href', '/finance/payments');
  await page.getByRole('button', { name: 'Reverse Sample transfer', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('balancing movement');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Reverse payment', exact: true })).toBeVisible();
});

test('hides record management from non-system administrators and refuses direct access', async ({ page }) => {
  const { queries } = await setup(page, false);
  await expect(page.getByRole('alert')).toContainText('super administrators');
  await expect(page.getByRole('link', { name: 'Data management', exact: true })).toHaveCount(0);
  expect(queries).not.toContain('/records/catalog');
});
