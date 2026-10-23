import 'reflect-metadata';
import { BadRequestException, NotFoundException, UnsupportedMediaTypeException, ValidationPipe } from '@nestjs/common';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { BulkDocumentsDto, BulkMoveDocumentsDto, DocumentsController, UpdateDocumentTitleDto } from './documents.controller';

function setup() {
  const documents = [
    { id: 'a', folderId: 'source' as string | null, deletedAt: null as Date | null },
    { id: 'b', folderId: 'source' as string | null, deletedAt: null as Date | null },
    { id: 'outside', folderId: 'source' as string | null, deletedAt: null as Date | null },
    { id: 'deleted', folderId: 'source' as string | null, deletedAt: new Date() as Date | null },
  ];
  const tx = {
    folder: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => where.id === 'target' ? { id: 'target' } : null) },
    document: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => documents.filter((row) => where.id.in.includes(row.id) && row.deletedAt === null)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { folderId?: string | null; deletedAt?: Date } }) => {
        const matches = documents.filter((row) => where.id.in.includes(row.id) && row.deletedAt === null);
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      }),
    },
  };
  const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { controller: new DocumentsController(prisma as unknown as PrismaService), documents, tx, prisma };
}

describe('bulk file operations', () => {
  it.each(['target', null])('moves the selected files to %s and leaves other files unchanged', async (folderId) => {
    const { controller, documents } = setup();
    await expect(controller.moveDocuments('co-1', { ids: ['a', 'b'], folderId })).resolves.toEqual({ moved: 2 });
    expect(documents.slice(0, 2).map((row) => row.folderId)).toEqual([folderId, folderId]);
    expect(documents[2].folderId).toBe('source');
    expect(documents[3].folderId).toBe('source');
  });

  it('soft deletes only selected files', async () => {
    const { controller, documents } = setup();
    await expect(controller.deleteDocuments('co-1', { ids: ['a', 'b'] })).resolves.toEqual({ deleted: 2 });
    expect(documents[0].deletedAt).toBeInstanceOf(Date);
    expect(documents[1].deletedAt).toEqual(documents[0].deletedAt);
    expect(documents[2].deletedAt).toBeNull();
  });

  it.each(['missing', 'deleted'])('rejects an unavailable target folder %s before moving any files', async (folderId) => {
    const { controller, tx } = setup();
    await expect(controller.moveDocuments('co-1', { ids: ['a', 'b'], folderId })).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.document.updateMany).not.toHaveBeenCalled();
  });

  it.each(['moveDocuments', 'deleteDocuments'] as const)('rejects the whole %s batch when one file is missing or deleted', async (method) => {
    for (const id of ['missing', 'deleted']) {
      const { controller, tx } = setup();
      await expect(controller[method]('co-1', { ids: ['a', id], folderId: 'target' })).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.document.updateMany).not.toHaveBeenCalled();
    }
  });
});

describe('bulk request validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it.each([[], ['a', 'a'], [123], 'a', Array.from({ length: 201 }, (_, index) => `file-${index}`)])('rejects invalid file selection %j', async (ids) => {
    await expect(pipe.transform({ ids }, { type: 'body', metatype: BulkDocumentsDto })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('requires an explicit destination and accepts top level as null', async () => {
    await expect(pipe.transform({ ids: ['a'] }, { type: 'body', metatype: BulkMoveDocumentsDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ids: ['a'], folderId: null }, { type: 'body', metatype: BulkMoveDocumentsDto })).resolves.toMatchObject({ folderId: null });
  });
});

describe('optional document titles', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  it.each(['  Project drawing  ', '', '   ', null])('saves or clears title %j without touching filenames, versions, or storage', async (title) => {
    const document = {
      id: 'file', name: 'drawing.pdf', title: 'Old title' as string | null, currentVersion: 1,
      versions: [{ fileName: 'drawing.pdf', storageKey: 'original-storage-key', checksum: 'original-checksum' }],
    };
    const updateMany = vi.fn(async ({ data }: { data: { title: string | null } }) => {
      Object.assign(document, data);
      return { count: 1 };
    });
    const controller = new DocumentsController({ document: { updateMany } } as unknown as PrismaService);
    await controller.updateTitle('co-1', 'file', { title });
    expect(document).toEqual({
      id: 'file', name: 'drawing.pdf', title: title?.trim() || null, currentVersion: 1,
      versions: [{ fileName: 'drawing.pdf', storageKey: 'original-storage-key', checksum: 'original-checksum' }],
    });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'file', companyId: 'co-1', deletedAt: null }, data: { title: title?.trim() || null } });
  });

  it('does not edit missing or deleted files', async () => {
    const controller = new DocumentsController({ document: { updateMany: vi.fn(async () => ({ count: 0 })) } } as unknown as PrismaService);
    await expect(controller.updateTitle('co-1', 'missing', { title: 'New title' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([{ title: 'x'.repeat(251) }, { title: 123 }, {}, { title: 'New title', name: 'renamed.pdf' }])('rejects invalid metadata or filename changes %j', async (body) => {
    await expect(pipe.transform(body, { type: 'body', metatype: UpdateDocumentTitleDto })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([{ title: '' }, { title: null }])('accepts an empty optional title %j', async (body) => {
    await expect(pipe.transform(body, { type: 'body', metatype: UpdateDocumentTitleDto })).resolves.toMatchObject(body);
  });
});

describe('authenticated document streaming', () => {
  const createdFiles: string[] = [];
  afterAll(() => createdFiles.forEach((path) => unlinkSync(path)));

  function controllerFor(fileName: string, mimeType: string, deleted = false) {
    const storageKey = `test-preview-${randomUUID()}`;
    const directory = join(process.cwd(), 'uploads');
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, storageKey);
    writeFileSync(filePath, 'fixture bytes');
    createdFiles.push(filePath);
    const prisma = { document: { findFirst: vi.fn(async ({ where }: { where: { deletedAt: null } }) => deleted && where.deletedAt === null
      ? null : { name: fileName, title: 'Friendly display title', versions: [{ fileName, mimeType, storageKey }] }) } };
    return new DocumentsController(prisma as unknown as PrismaService);
  }

  it.each([
    ['scan.PDF', 'application/pdf'], ['photo.jpg', 'image/jpeg'],
    ['scan.tif', 'image/tiff'], ['scan.tiff', 'image/tiff'],
  ])('streams %s inline with the proper MIME type', async (fileName, mimeType) => {
    const controller = controllerFor(fileName, 'application/octet-stream');
    const response = Object.assign(new PassThrough(), { setHeader: vi.fn() });
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(chunk));
    const ended = new Promise<void>((resolve) => response.on('end', resolve));
    await controller.preview('co-1', 'file', response as unknown as Response);
    await ended;
    expect(Buffer.concat(chunks).toString()).toBe('fixture bytes');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', mimeType);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', `inline; filename="${fileName}"`);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('refuses to preview arbitrary HTML', async () => {
    const controller = controllerFor('unsafe.html', 'text/html');
    await expect(controller.preview('co-1', 'file', {} as Response)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it.each(['preview', 'download'] as const)('does not allow %s of a deleted file', async (method) => {
    const controller = controllerFor('scan.pdf', 'application/pdf', true);
    await expect(controller[method]('co-1', 'deleted', {} as Response)).rejects.toBeInstanceOf(NotFoundException);
  });
});
