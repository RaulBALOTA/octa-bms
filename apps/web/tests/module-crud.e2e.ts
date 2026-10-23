import { expect, test, type Page } from '@playwright/test';
import { RECORD_RESOURCES, recordFields, type RecordField } from '../../api/src/modules/records/record-catalog';

type Row = Record<string, unknown> & { id: string; _key: string; _label: string; companyId: string; deletedAt: string | null };
const nativeLists: Record<string, string> = {
  '/crm/partners': 'partners', '/hr/employees': 'employees', '/assets': 'assets', '/contracts': 'contracts',
  '/finance/invoices': 'invoices', '/finance/payments': 'payments', '/hr/leave-requests': 'leave',
  '/legal/cases': 'cases', '/legal/compliance-items': 'compliance', '/procurement/requests': 'requests',
};
async function setup(page: Page, path: string, admin = true) {
  const pageErrors: string[] = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'own' }, version: 0 }));
  });
  const catalog = Object.entries(RECORD_RESOURCES).map(([key, definition]) => ({ key, module: definition.module, name: { en: definition.en, de: definition.de }, fields: recordFields(definition),
    columns: recordFields(definition).filter((field) => ['name','title','firstName','lastName','email','code','status'].includes(field.name)).map((field) => field.name).slice(0, 5),
    native: definition.native, createNative: !!definition.createNative, companyScoped: true, canArchive: recordFields(definition).some((field) => field.name === 'deletedAt'), deleteAction: key === 'payments' ? 'reverse' : 'delete' }));
  function values(fields: RecordField[]): Record<string, unknown> {
    return Object.fromEntries(fields.map((field) => [field.name, field.fields ? [values(field.fields)] : field.list ? [] : field.type === 'DateTime' ? '2026-10-12T00:00:00Z'
      : field.type === 'Json' ? { steps: [{ code: 'review', type: 'approval' }] } : field.type === 'Decimal' ? '10' : field.type === 'Int' || field.type === 'Float' ? field.name === 'year' ? 2026 : 1
      : field.type === 'Boolean' ? field.default ?? false : field.default ?? field.values?.[0] ?? (/email/i.test(field.name) ? 'sample@example.com' : `Sample ${field.name}`)]));
  }
  const data: Record<string, Row[]> = {};
  for (const item of catalog) {
    const row = { ...values(item.fields), id: `sample-${item.key}`, _key: `sample-${item.key}`, _label: `Sample ${item.key}`, companyId: 'own', deletedAt: null } as Row;
    Object.assign(row, { name: `Sample ${item.key}`, title: `Sample ${item.key}`, firstName: 'Sample', lastName: 'Person', currencyCode: 'EUR', countryCode: 'DE',
      partner: { id: 'sample-partners', name: 'Sample partners' }, partnerId: 'sample-partners', employee: { firstName: 'Sample', lastName: 'Person' }, type: row.type,
      contacts: [], crmActivities: [], assignments: [], allocations: [], _count: { contacts: 0, opportunities: 0, instances: 0, applicants: 0, userRoles: 0 }, permissions: [],
      bankAccount: { id: 'sample-bankAccounts', name: 'Sample bankAccounts' }, definition: { steps: [{ code: 'review', type: 'approval' }] },
      employeeNumber: 'EMP-001', invoiceNumber: 'R-2026-00001', contractNumber: 'CT-001', requestNumber: 'PR-001', assetNumber: 'AST-001', reference: 'Sample transfer',
      status: item.key === 'employees' || item.key === 'partners' ? 'ACTIVE' : item.key === 'assets' ? 'IN_STOCK' : item.key === 'leave' ? 'REQUESTED' : item.key === 'compliance' || item.key === 'cases' ? 'OPEN' : item.key === 'goals' ? 'ON_TRACK' : 'DRAFT',
      stage: item.key === 'applicants' ? 'NEW' : 'LEAD', updatedAt: '2026-10-12T00:00:00Z', roleIds: [], userIds: [], permissionCodes: [],
      netAmount: '10', grossAmount: '11.9', taxAmount: '1.9', paidAmount: '0', totalEstimate: '10', balance: 100, iban: 'DE001234',
      viewCount: 0, probability: 10, estimatedValue: '100', participants: [], isSystem: false, isSystemAdmin: false, bankAccountId: 'sample-bankAccounts',
    });
    for (const field of ['firstName','lastName','name','title','employeeNumber','invoiceNumber','contractNumber','requestNumber','assetNumber']) if (!item.fields.some((item) => item.name === field)) delete row[field];
    data[item.key] = [row];
  }
  const mutations: { method: string; path: string; companyId: string; data?: Record<string, unknown> }[] = []; const reads: string[] = []; let counter = 0;
  let rejectDelete = false;
  const hydrate = (key: string, row: Row) => {
    const result = structuredClone(row);
    const refs = (fields: RecordField[], value: Record<string, unknown>) => {
      value._references = Object.fromEntries(fields.filter((field) => field.reference && !field.list).map((field) => [field.name, field.name === 'currencyCode' ? 'Euro' : field.name === 'partnerId' ? 'Sample partners' : `Related ${field.name}`]));
      for (const field of fields.filter((field) => field.fields)) for (const child of value[field.name] as Record<string, unknown>[] ?? []) refs(field.fields!, child);
    };
    refs(recordFields(RECORD_RESOURCES[key]), result); return result;
  };
  const paged = (rows: unknown[]) => ({ data: rows, meta: { page: 1, pageSize: 25, total: rows.length, totalPages: 1 } });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const pathname = url.pathname.replace('/api/v1', ''); const method = request.method(); const scope = request.headers()['x-company-id'];
    if (method === 'GET') reads.push(pathname);
    if (pathname === '/auth/me') return route.fulfill({ json: { id: 'admin', firstName: 'Test', lastName: 'Admin', email: 'admin@example.com', isSystemAdmin: admin, permissions: [], memberships: [{ isDefault: true, company: { id: 'own', name: 'Holding', code: 'HOLD' } }, { isDefault: false, company: { id: 'other', name: 'Subsidiary', code: 'SUB' } }] } });
    if (pathname === '/records/catalog') return route.fulfill({ json: catalog });
    const lookup = /^\/records\/([^/]+)\/lookup\/(.+)$/.exec(pathname);
    if (lookup) {
      const parts = lookup[2].split('.'); let field = recordFields(RECORD_RESOURCES[lookup[1]]).find((field) => field.name === parts[0]); if (parts[1]) field = field?.fields?.find((child) => child.name === parts[1]);
      const selected = url.searchParams.get('selected') || (field?.reference?.model === 'Currency' ? 'EUR' : field?.reference?.model === 'Country' ? 'DE' : `Related ${parts.at(-1)}`);
      return route.fulfill({ json: selected.split(',').map((value) => ({ value, label: field?.reference?.model === 'Currency' ? 'Euro' : field?.reference?.model === 'Country' ? 'Germany' : `Related ${parts.at(-1)}` })) });
    }
    const record = /^\/records\/([^/]+)(?:\/(.*))?$/.exec(pathname);
    if (record) {
      const key = record[1]; const action = record[2]; const rows = data[key];
      if (method === 'GET') return route.fulfill({ json: action && action !== 'archived/list' ? hydrate(key, rows.find((row) => row.id === action)!) : paged(rows.filter((row) => row.companyId === scope && (action === 'archived/list' ? !!row.deletedAt : !row.deletedAt)).map((row) => hydrate(key, row))) });
      const body = request.postData() ? request.postDataJSON() : {};
      mutations.push({ method, path: pathname, companyId: scope, ...structuredClone(body) });
      if (method === 'DELETE') {
        if (rejectDelete) return route.fulfill({ status: 409, json: { message: 'This record is still used by linked data. Reassign those records first.' } });
        rows.find((row) => row.id === action)!.deletedAt = '2026-10-12T10:00:00Z'; return route.fulfill({ json: { deleted: 1 } });
      }
      if (action?.endsWith('/restore')) { rows.find((row) => row.id === action.split('/')[0])!.deletedAt = null; return route.fulfill({ json: {} }); }
      if (method === 'PATCH') { Object.assign(rows.find((row) => row.id === action)!, body.data); return route.fulfill({ json: { id: action } }); }
      const created = { ...rows[0], ...body.data, id: `created-${++counter}`, _key: `created-${counter}`, _label: body.data.name ?? body.data.title ?? 'Real record', deletedAt: null }; rows.push(created); return route.fulfill({ json: { id: created.id } });
    }
    const list = nativeLists[pathname];
    if (list) {
      if (method === 'GET') return route.fulfill({ json: paged(data[list].filter((row) => row.companyId === scope && !row.deletedAt)) });
      const body = request.postDataJSON(); mutations.push({ method, path: pathname, companyId: scope, data: body });
      const created = { ...data[list][0], ...body, id: `created-${++counter}`, _key: `created-${counter}`, _label: body.name ?? body.title ?? 'Real record' }; data[list].push(created); return route.fulfill({ json: created });
    }
    if (pathname === '/sales/opportunities/pipeline') return route.fulfill({ json: ['LEAD','QUALIFIED','GO_NO_GO','PROPOSAL','NEGOTIATION'].map((stage, index) => ({ stage, count: index === 0 ? data.opportunities.filter((row) => !row.deletedAt).length : 0, totalValue: 100, weightedValue: 10, items: index === 0 ? data.opportunities.filter((row) => !row.deletedAt && row.companyId === scope) : [] })) });
    if (pathname === '/hr/job-openings') return route.fulfill({ json: data.openings.filter((row) => !row.deletedAt) });
    if (pathname === '/hr/recruitment/open-positions') return route.fulfill({ json: [] });
    if (pathname === '/hr/applicants/board') return route.fulfill({ json: ['NEW','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED'].map((stage, index) => ({ stage, items: index === 0 ? data.applicants.filter((row) => !row.deletedAt).map((row) => ({ ...row, jobOpening: { title: 'Sample openings' } })) : [] })) });
    const collection = ({ '/knowledge/articles': 'articles', '/workflow/definitions': 'workflows', '/contracts/guarantees': 'guarantees', '/contracts/insurance': 'insurance', '/communication/meetings': 'meetings', '/communication/email-templates': 'templates', '/finance/bank-accounts': 'bankAccounts', '/identity/roles': 'roles' } as Record<string, string>)[pathname];
    if (collection) { const rows = data[collection].filter((row) => !row.deletedAt && row.companyId === scope); return route.fulfill({ json: ['articles','meetings'].includes(collection) ? paged(rows) : rows }); }
    if (pathname === '/identity/users') return route.fulfill({ json: paged(data.users) });
    if (pathname.startsWith('/bi/reports/')) return route.fulfill({ json: { code: 'revenue-by-client', columns: [], rows: [] } });
    if (pathname === '/communication/messages' || pathname === '/communication/activity' || pathname === '/bi/reports') return route.fulfill({ json: [] });
    if (pathname.startsWith('/master/')) return route.fulfill({ json: [] });
    return route.fulfill({ json: { count: 0, ...paged([]) } });
  });
  await page.goto(path);
  return { data, mutations, reads, pageErrors, rejectDeletion: () => { rejectDelete = true; } };
}

for (const item of [
  { path: '/crm/partners', resource: 'partners', label: 'Sample partners', field: 'Name' },
  { path: '/hr/employees', resource: 'employees', label: 'Sample Person', field: 'First name' },
  { path: '/assets', resource: 'assets', label: 'Sample assets', field: 'Name' },
  { path: '/contracts', resource: 'contracts', label: 'Sample contracts', field: 'Title' },
  { path: '/legal/cases', resource: 'cases', label: 'Sample cases', field: 'Title' },
  { path: '/legal', resource: 'compliance', label: 'Sample compliance', field: 'Title' },
]) test(`view, edit and delete directly in ${item.path}`, async ({ page }) => {
  const state = await setup(page, item.path);
  await page.getByRole('button', { name: `View ${item.label}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(item.label);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: `Edit ${item.label}`, exact: true }).click();
  await page.getByRole('dialog').getByLabel(item.field, { exact: true }).fill('Real business data');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.mutations[0]).toMatchObject({ method: 'PATCH', path: `/records/${item.resource}/sample-${item.resource}`, companyId: 'own' });
  await page.getByRole('button', { name: /^Delete / }).first().click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(item.path);
  expect(state.reads).not.toContain(`${Object.entries(nativeLists).find(([, key]) => key === item.resource)![0]}/sample-${item.resource}`);
  expect(state.pageErrors).toEqual([]);
});

test('creates a partner in CRM using the module New form', async ({ page }) => {
  const state = await setup(page, '/crm/partners'); await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: false }).fill('Real customer');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /RC Real customer/ })).toBeVisible();
  expect(state.mutations[0].path).toBe('/crm/partners'); await expect(page).toHaveURL(/\/crm\/partners$/); expect(state.pageErrors).toEqual([]);
});

for (const item of [
  { path: '/sales/pipeline', resource: 'opportunities', label: 'Sample opportunities', field: 'Title' },
  { path: '/knowledge', resource: 'articles', label: 'Sample articles', field: 'Title' },
  { path: '/contracts/guarantees', resource: 'guarantees', label: 'Sample guaranteeNumber', field: 'Issuing bank' },
  { path: '/contracts/insurance', resource: 'insurance', label: 'Sample policyNumber', field: 'Insurer' },
  { path: '/hr/recruitment', resource: 'applicants', label: 'Sample Person', field: 'First name' },
]) test(`edits and deletes a card in ${item.path} without leaving the module`, async ({ page }) => {
  const state = await setup(page, item.path);
  await page.getByRole('button', { name: `Edit ${item.label}`, exact: true }).click();
  await page.getByRole('dialog').getByLabel(new RegExp(`^${item.field}$`, 'i')).fill('Real card data');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.mutations[0].path).toBe(`/records/${item.resource}/sample-${item.resource}`);
  await page.getByRole('button', { name: /^Delete / }).filter({ has: page.locator('svg') }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.data[item.resource][0].deletedAt).toBeTruthy(); await expect(page).toHaveURL(new RegExp(item.path + '$')); expect(state.pageErrors).toEqual([]);
});

test('creates and edits a department in HR on the same route', async ({ page }) => {
  const state = await setup(page, '/hr/employees'); await page.getByRole('button', { name: 'Departments', exact: true }).click();
  const section = page.getByRole('region', { name: 'Departments', exact: true });
  await section.getByRole('button', { name: 'New', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code', { exact: false }).fill('REAL'); await dialog.getByLabel('Name', { exact: false }).first().fill('Actual department');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await section.getByRole('button', { name: 'Edit Actual department', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Actual department updated');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.mutations.map((mutation) => mutation.path)).toEqual(['/records/departments','/records/departments/created-1']);
  await expect(page).toHaveURL(/\/hr\/employees$/); expect(state.pageErrors).toEqual([]);
});

test('keeps rejected deletion reviewable in the module and preserves the row', async ({ page }) => {
  const state = await setup(page, '/crm/partners'); state.rejectDeletion();
  await page.getByRole('button', { name: 'Delete Sample partners', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('linked data'); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Sample partners', exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/crm\/partners$/); expect(state.pageErrors).toEqual([]);
});

test('restores a deleted CRM partner inside its module', async ({ page }) => {
  const state = await setup(page, '/crm/partners'); await page.getByRole('button', { name: 'Delete Sample partners', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('button', { name: 'Deleted records', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore Sample partners', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Restore Sample partners', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Sample partners', exact: true })).toBeVisible(); expect(state.pageErrors).toEqual([]);
});

test('closes a record editor when changing company and hides CRUD for non-admins', async ({ page }) => {
  const state = await setup(page, '/crm/partners'); await page.getByRole('button', { name: 'Edit Sample partners', exact: true }).click();
  await page.locator('header select').selectOption('other'); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.mutations).toHaveLength(0);
});

test('leaves native read-only users without administrator mutation controls', async ({ page }) => {
  const state = await setup(page, '/crm/partners', false); await expect(page.getByRole('cell', { name: /SP Sample partners/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0); await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Related records' })).toHaveCount(0); expect(state.reads).not.toContain('/records/catalog');
});

test('edits invoice lines from Finance while keeping calculated and posted fields protected', async ({ page }) => {
  const state = await setup(page, '/finance/invoices');
  await page.getByRole('button', { name: 'Edit R-2026-00001', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description', { exact: false }).fill('Actual services');
  await dialog.getByLabel('Quantity', { exact: false }).fill('3'); await dialog.getByLabel('Unit price', { exact: false }).fill('10.01');
  await expect(dialog.getByLabel('Gross amount')).toHaveCount(0); await expect(dialog.getByLabel('Status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.mutations[0]).toMatchObject({ path: '/records/invoices/sample-invoices', data: { lines: [expect.objectContaining({ description: 'Actual services', quantity: '3', unitPrice: '10.01' })] } });
  expect(state.mutations[0].data).not.toHaveProperty('grossAmount'); await expect(page).toHaveURL(/\/finance\/invoices$/); expect(state.pageErrors).toEqual([]);
});

test('edits and reverses a payment from the Payments module', async ({ page }) => {
  const state = await setup(page, '/finance/payments');
  await page.getByRole('button', { name: 'Edit Sample transfer', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Counterparty', { exact: true }).fill('Actual counterparty');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reverse Sample transfer', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('balancing movement');
  await page.getByRole('dialog').getByRole('button', { name: 'Reverse payment', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.mutations.map((mutation) => [mutation.method, mutation.path])).toEqual([['PATCH','/records/payments/sample-payments'], ['DELETE','/records/payments/sample-payments']]);
  await expect(page).toHaveURL(/\/finance\/payments$/); expect(state.pageErrors).toEqual([]);
});

test('edits and deletes a purchase request inside Procurement', async ({ page }) => {
  const state = await setup(page, '/procurement');
  await page.getByRole('button', { name: 'Edit PR-001', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Description', { exact: false }).fill('Actual purchase item');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Actual purchase item', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete PR-001', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.data.requests[0].deletedAt).toBeTruthy(); await expect(page).toHaveURL(/\/procurement$/); expect(state.pageErrors).toEqual([]);
});

test('manages user and role records directly in Administration', async ({ page }) => {
  const state = await setup(page, '/admin');
  await page.getByRole('button', { name: 'Edit Sample Person', exact: true }).click();
  await page.getByRole('dialog').getByLabel('First name', { exact: true }).fill('Actual');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Sample roles', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.data.roles[0].deletedAt).toBeTruthy(); await expect(page).toHaveURL(/\/admin$/); expect(state.pageErrors).toEqual([]);
});

test('manages dashboards inside BI and reports invalid structured data before saving', async ({ page }) => {
  const state = await setup(page, '/bi'); await page.getByRole('button', { name: 'Dashboards', exact: true }).click();
  const section = page.getByRole('region', { name: 'Dashboards', exact: true }); await section.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: false }).fill('Actual dashboard'); await page.getByRole('dialog').getByLabel('Layout', { exact: false }).fill('invalid JSON');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('structured data'); expect(state.mutations).toHaveLength(0);
  await page.getByRole('dialog').getByLabel('Layout', { exact: false }).fill('{"widgets":[]}'); await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.mutations[0]).toMatchObject({ path: '/records/dashboards', data: { name: 'Actual dashboard', layout: { widgets: [] } } });
  await expect(page).toHaveURL(/\/bi$/); expect(state.pageErrors).toEqual([]);
});

test('edits and deletes meeting minutes inside Communication', async ({ page }) => {
  const state = await setup(page, '/communication'); await page.getByRole('button', { name: 'Meeting Minutes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Sample meetings', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Actual meeting minutes');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Actual meeting minutes', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.data.meetings[0].deletedAt).toBeTruthy(); await expect(page).toHaveURL(/\/communication$/); expect(state.pageErrors).toEqual([]);
});

test('views and deletes a workflow definition inside Workflows', async ({ page }) => {
  const state = await setup(page, '/workflow'); await page.getByRole('button', { name: 'View Sample workflows', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Sample workflows'); await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Sample workflows', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Sample workflows', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.data.workflows[0].deletedAt).toBeTruthy(); await expect(page).toHaveURL(/\/workflow$/); expect(state.pageErrors).toEqual([]);
});
