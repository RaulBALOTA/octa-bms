import { expect, test, type Page } from '@playwright/test';
import { tiffFixture } from './tiff-fixture';

interface TestDocument {
  id: string;
  name: string;
  title: string | null;
  folderId: string | null;
  currentVersion: number;
  updatedAt: string;
  versions: { fileName: string; mimeType: string; sizeBytes: number; version: number; createdAt: string }[];
}

function pdfFixture() {
  const content = 'BT /F1 14 Tf 30 150 Td (OCTA preview test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function openDocuments(page: Page, isSystemAdmin = true) {
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'test-token', refreshToken: 'test-refresh', companyId: 'company' }, version: 0 }));
  });
  const files: TestDocument[] = [
    ['pdf', 'drawing.pdf', 'application/pdf'], ['jpg', 'photo.jpg', 'image/jpeg'], ['tiff', 'scan.tiff', 'image/tiff'],
  ].map(([id, name, mimeType]) => ({
    id, name, title: null, folderId: 'source', currentVersion: 1, updatedAt: '2026-10-12T12:00:00Z',
    versions: [{ fileName: name, mimeType, sizeBytes: 1004, version: 1, createdAt: '2026-10-12T12:00:00Z' }],
  }));
  const moves: { ids: string[]; folderId: string | null }[] = [];
  const deletions: string[][] = [];
  const uploads: string[] = [];
  const titleUpdates: { id: string; title: string | null }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') {
      return route.fulfill({ json: {
        id: 'user', email: 'test@example.com', firstName: 'Test', lastName: 'Admin', isSystemAdmin,
        permissions: ['documents.documents.read', 'documents.folders.read'],
        memberships: [{ isDefault: true, company: { id: 'company', code: 'OCTA', name: 'OCTA' } }],
      } });
    }
    if (path === '/documents/folders') {
      return route.fulfill({ json: ['source', 'target'].map((id) => ({
        id, name: id === 'source' ? 'Source' : 'Target', path: id === 'source' ? '/Source' : '/Target', parentId: null,
        _count: { documents: files.filter((file) => file.folderId === id).length, children: 0 },
      })) });
    }
    if (path === '/documents') {
      const folderId = url.searchParams.get('folderId');
      const data = files.filter((file) => !folderId || file.folderId === folderId).map((file) => ({ ...file, folder: { id: file.folderId, name: file.folderId === 'target' ? 'Target' : 'Source' } }));
      return route.fulfill({ json: { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } } });
    }
    if (path.endsWith('/title') && request.method() === 'PATCH') {
      const id = path.split('/')[2];
      const { title } = request.postDataJSON();
      const file = files.find((row) => row.id === id)!;
      file.title = title;
      titleUpdates.push({ id, title });
      return route.fulfill({ json: { id, title } });
    }
    if (path === '/documents/bulk-move') {
      const body = request.postDataJSON();
      moves.push(body);
      files.filter((file) => body.ids.includes(file.id)).forEach((file) => { file.folderId = body.folderId; });
      return route.fulfill({ json: { moved: body.ids.length } });
    }
    if (path === '/documents/bulk-delete') {
      const { ids } = request.postDataJSON();
      deletions.push(ids);
      for (let index = files.length - 1; index >= 0; index--) if (ids.includes(files[index].id)) files.splice(index, 1);
      return route.fulfill({ json: { deleted: ids.length } });
    }
    if (path === '/documents/upload') {
      const multipart = request.postDataBuffer()?.toString() ?? '';
      uploads.push(multipart);
      if (multipart.includes('fail.jpg')) return route.fulfill({ status: 500, json: { message: 'Test upload failure' } });
      const name = /filename="([^"]+)"/.exec(multipart)?.[1] ?? 'uploaded.pdf';
      const folderId = /name="folderId"\r\n\r\n([^\r]+)/.exec(multipart)?.[1] ?? null;
      const file: TestDocument = {
        id: `uploaded-${uploads.length}`, name, title: null, folderId, currentVersion: 1, updatedAt: '2026-10-12T12:00:00Z',
        versions: [{ fileName: name, mimeType: name.endsWith('.tiff') ? 'image/tiff' : 'application/pdf', sizeBytes: 1004, version: 1, createdAt: '2026-10-12T12:00:00Z' }],
      };
      files.push(file);
      return route.fulfill({ json: file });
    }
    if (path.endsWith('/preview')) {
      expect(request.headers().authorization).toBe('Bearer test-token');
      expect(request.headers()['x-company-id']).toBe('company');
      if (path.includes('/tiff/')) return route.fulfill({ contentType: 'image/tiff', body: Buffer.from(tiffFixture()) });
      if (path.includes('/pdf/')) return route.fulfill({ contentType: 'application/pdf', body: pdfFixture() });
      return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(
        '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwC/AB//2Q==', 'base64') });
    }
    return route.fulfill({ json: { count: 0 } });
  });
  await page.goto('/documents');
  await expect(page.getByRole('button', { name: 'drawing.pdf', exact: true })).toBeVisible();
  await page.getByTitle('/Source', { exact: true }).click();
  return { files, moves, deletions, uploads, titleUpdates };
}

test('selects multiple files, moves them, and clears selection in the refreshed folder', async ({ page }) => {
  const { moves } = await openDocuments(page);
  await page.getByRole('checkbox', { name: 'Select drawing.pdf', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select photo.jpg', exact: true }).check();
  await expect(page.getByText('2 files selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move selected', exact: true }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('target');
  await page.getByRole('dialog').getByRole('button', { name: 'Move selected', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'drawing.pdf', exact: true })).toHaveCount(0);
  expect(moves).toEqual([{ ids: ['pdf', 'jpg'], folderId: 'target' }]);
  await page.getByTitle('/Target', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'drawing.pdf', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select drawing.pdf', exact: true })).not.toBeChecked();
});

test('select all requires confirmation before deleting all selected files', async ({ page }) => {
  const { deletions } = await openDocuments(page);
  await page.getByRole('checkbox', { name: 'Select all files on this page' }).check();
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Delete all 3 selected files?');
  expect(deletions).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete selected', exact: true }).click();
  await expect(page.getByText('No documents — upload the first file')).toBeVisible();
  expect(deletions).toEqual([['pdf', 'jpg', 'tiff']]);
});

test('uploads every chosen file to the active folder and reports individual failures', async ({ page }) => {
  const { uploads } = await openDocuments(page);
  await page.locator('input[type=file]').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    { name: 'fail.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fixture') },
    { name: 'last.tiff', mimeType: 'image/tiff', buffer: Buffer.from(tiffFixture()) },
  ]);
  await expect(page.getByRole('alert')).toContainText('fail.jpg: Test upload failure');
  expect(uploads).toHaveLength(3);
  expect(uploads.every((body) => body.includes('name="folderId"\r\n\r\nsource'))).toBe(true);
  await expect(page.getByText('2 files uploaded', { exact: true })).toBeVisible();
});

test('renders a TIFF in the worker and switches between its pages', async ({ page }) => {
  await openDocuments(page);
  await page.getByRole('button', { name: 'scan.tiff', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const canvas = dialog.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(dialog).toContainText('Page 1 of 2');
  const pixel = () => canvas.evaluate((element: HTMLCanvasElement) => [...element.getContext('2d')!.getImageData(0, 0, 1, 1).data]);
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(dialog).toContainText('Page 2 of 2');
  expect(await pixel()).toEqual([0, 255, 0, 255]);
  await dialog.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(dialog).toContainText('Page 1 of 2');
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('opens PDFs and JPGs in the preview dialog', async ({ page }) => {
  await openDocuments(page);
  await page.getByRole('button', { name: 'drawing.pdf', exact: true }).click();
  await expect(page.getByRole('dialog').locator('iframe')).toHaveAttribute('src', /^blob:/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'photo.jpg', exact: true }).click();
  const image = page.getByRole('dialog').getByRole('img', { name: 'photo.jpg' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
});

test('read-only users can preview files and have no upload or bulk mutation controls', async ({ page }) => {
  await openDocuments(page, false);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit title for/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete file/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'scan.tiff', exact: true }).click();
  await expect(page.getByRole('dialog').locator('canvas')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete file', exact: true })).toHaveCount(0);
});

test('shows bulk deletion before selection and deletes a newly uploaded file using its visible trash button', async ({ page }) => {
  const { deletions } = await openDocuments(page);
  await expect(page.getByRole('button', { name: 'Delete selected', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete selected', exact: true })).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles({ name: 'uploaded.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  const file = page.getByRole('button', { name: 'uploaded.pdf', exact: true });
  await expect(file).toBeVisible();
  const trash = page.getByRole('button', { name: 'Delete file uploaded.pdf', exact: true });
  await expect(trash).toBeVisible();
  await trash.click();
  await expect(page.getByRole('dialog')).toContainText('Delete the file "uploaded.pdf"?');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deletions).toHaveLength(0);
  await expect(file).toBeVisible();
  await trash.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(file).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'drawing.pdf', exact: true })).toBeVisible();
  expect(deletions).toEqual([['uploaded-1']]);
});

test('deletes a file from its preview after confirmation', async ({ page }) => {
  const { deletions } = await openDocuments(page);
  await page.getByRole('button', { name: 'scan.tiff', exact: true }).click();
  await expect(page.getByRole('dialog').locator('canvas')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Delete the file "scan.tiff"?');
  expect(deletions).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'scan.tiff', exact: true })).toHaveCount(0);
  expect(deletions).toEqual([['tiff']]);
});

test('keeps a file trash button within view when long filenames make the table overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const { files } = await openDocuments(page);
  const name = `${'very-long-filename-'.repeat(12)}.pdf`;
  files[0].name = name;
  await page.reload();
  const trash = page.getByRole('button', { name: `Delete file ${name}`, exact: true });
  await expect(trash).toBeVisible();
  const bounds = await trash.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
  await trash.click();
  await expect(page.getByRole('dialog')).toContainText(name);
});

test('adds, edits, and clears an optional title while keeping the original filename', async ({ page }) => {
  const { files, titleUpdates } = await openDocuments(page);
  const original = structuredClone(files[0]);
  await page.getByRole('button', { name: 'Edit title for drawing.pdf', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('drawing.pdf');
  await dialog.getByRole('textbox', { name: 'Title (optional)' }).fill('Project drawing');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit title for drawing.pdf', exact: true })).toContainText('Project drawing');
  await page.getByRole('button', { name: 'drawing.pdf', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Project drawing', exact: true })).toBeVisible();
  await expect(dialog).toContainText('drawing.pdf');
  await page.keyboard.press('Escape');
  await page.getByTitle('/Target', { exact: true }).click();
  await page.getByTitle('/Source', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit title for drawing.pdf', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Approved drawing');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit title for drawing.pdf', exact: true })).toContainText('Approved drawing');
  await page.getByRole('button', { name: 'Edit title for drawing.pdf', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit title for drawing.pdf', exact: true })).toContainText('Add title');
  expect(titleUpdates).toEqual([
    { id: 'pdf', title: 'Project drawing' }, { id: 'pdf', title: 'Approved drawing' }, { id: 'pdf', title: null },
  ]);
  expect(files[0]).toEqual(original);
});
