import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../core/auth/decorators';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import type { RbacService } from '../../core/rbac/rbac.service';
import { DocumentsController } from './documents.controller';

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  deletedAt: Date | null;
}

function setup() {
  const folders: FolderRow[] = [
    { id: 'source', name: 'Contracts', parentId: null, path: '/Contracts', deletedAt: null },
    { id: 'child', name: '2026', parentId: 'source', path: '/Contracts/2026', deletedAt: null },
    { id: 'grandchild', name: 'Drafts', parentId: 'child', path: '/Contracts/2026/Drafts', deletedAt: null },
    { id: 'destination', name: 'Archive', parentId: null, path: '/Archive', deletedAt: null },
    // A shared path prefix must never make this unrelated folder part of the subtree.
    { id: 'unrelated', name: 'Contracts-old', parentId: null, path: '/Contracts-old', deletedAt: null },
    { id: 'deleted', name: 'Deleted', parentId: null, path: '/Deleted', deletedAt: new Date() },
  ];
  const documents = [
    { id: 'direct-file', folderId: 'source' as string | null, deletedAt: null as Date | null },
    { id: 'nested-file', folderId: 'grandchild' as string | null, deletedAt: null as Date | null },
    { id: 'deleted-file', folderId: 'source' as string | null, deletedAt: new Date() as Date | null },
  ];
  const tx = {
    folder: {
      findMany: vi.fn(async (args?: { where: { deletedAt: null } }) => folders
        .filter((row) => !args?.where || row.deletedAt === null)
        .map((row) => ({ ...row }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FolderRow> }) => {
        const folder = folders.find((row) => row.id === where.id)!;
        Object.assign(folder, data);
        return { ...folder };
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: { in: string[] }; deletedAt: null };
        data: { deletedAt: Date };
      }) => {
        const matches = folders.filter((row) => where.id.in.includes(row.id) && row.deletedAt === null);
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      }),
    },
    document: {
      updateMany: vi.fn(async ({ where, data }: {
        where: { folderId: { in: string[] }; deletedAt: null };
        data: { deletedAt: Date };
      }) => {
        const matches = documents.filter((row) => row.folderId !== null && where.folderId.in.includes(row.folderId) && row.deletedAt === null);
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      }),
    },
  };
  const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
  const controller = new DocumentsController(prisma as unknown as PrismaService);
  const folder = (id: string) => folders.find((row) => row.id === id)!;
  return { controller, prisma, tx, folders, documents, folder };
}

describe('folder movement', () => {
  it('moves the entire tree while preserving document links and unrelated folders', async () => {
    const { controller, prisma, documents, folder } = setup();
    await controller.moveFolder('source', { parentId: 'destination' });
    expect(folder('source')).toMatchObject({ parentId: 'destination', path: '/Archive/Contracts' });
    expect(folder('child')).toMatchObject({ parentId: 'source', path: '/Archive/Contracts/2026' });
    expect(folder('grandchild').path).toBe('/Archive/Contracts/2026/Drafts');
    expect(folder('unrelated').path).toBe('/Contracts-old');
    expect(documents[0].folderId).toBe('source');
    expect(documents[1].folderId).toBe('grandchild');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('can move a nested folder to the top level', async () => {
    const { controller, folder } = setup();
    await controller.moveFolder('child', { parentId: null });
    expect(folder('child')).toMatchObject({ parentId: null, path: '/2026' });
    expect(folder('grandchild').path).toBe('/2026/Drafts');
    expect(folder('source').path).toBe('/Contracts');
  });

  it.each(['source', 'child', 'grandchild'])('rejects cyclic destination %s before changing anything', async (parentId) => {
    const { controller, tx } = setup();
    await expect(controller.moveFolder('source', { parentId })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.folder.update).not.toHaveBeenCalled();
  });

  it.each(['missing', 'deleted'])('rejects unavailable destination %s', async (parentId) => {
    const { controller, tx } = setup();
    await expect(controller.moveFolder('source', { parentId })).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.folder.update).not.toHaveBeenCalled();
  });

  it('rejects a name collision at the destination', async () => {
    const { controller, folders, tx } = setup();
    folders.push({ id: 'collision', name: 'Contracts', parentId: 'destination', path: '/Archive/Contracts', deletedAt: null });
    await expect(controller.moveFolder('source', { parentId: 'destination' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.folder.update).not.toHaveBeenCalled();
  });

  it('leaves a folder unchanged when the destination is already its parent', async () => {
    const { controller, tx } = setup();
    await controller.moveFolder('child', { parentId: 'source' });
    expect(tx.folder.update).not.toHaveBeenCalled();
  });
});

describe('recursive folder deletion', () => {
  it('soft deletes the whole subtree and its documents in one transaction', async () => {
    const { controller, folder, documents, prisma } = setup();
    const previouslyDeletedAt = documents[2].deletedAt;
    await expect(controller.deleteFolder('source')).resolves.toEqual({
      deleted: true, parentId: null, deletedFolderIds: ['source', 'child', 'grandchild'],
    });
    const deletedAt = folder('source').deletedAt;
    expect(deletedAt).toBeInstanceOf(Date);
    expect(folder('child').deletedAt).toEqual(deletedAt);
    expect(folder('grandchild').deletedAt).toEqual(deletedAt);
    expect(documents[0]).toMatchObject({ folderId: 'source', deletedAt });
    expect(documents[1]).toMatchObject({ folderId: 'grandchild', deletedAt });
    expect(documents[2].deletedAt).toEqual(previouslyDeletedAt);
    expect(folder('unrelated').deletedAt).toBeNull();
    expect(folder('destination').deletedAt).toBeNull();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('deletes a nested subtree while preserving its parent and documents outside it', async () => {
    const { controller, folder, documents } = setup();
    await expect(controller.deleteFolder('child')).resolves.toEqual({
      deleted: true, parentId: 'source', deletedFolderIds: ['child', 'grandchild'],
    });
    expect(folder('child').deletedAt).toBeInstanceOf(Date);
    expect(folder('grandchild').deletedAt).toBeInstanceOf(Date);
    expect(documents[1].deletedAt).toBeInstanceOf(Date);
    expect(documents[0].folderId).toBe('source');
    expect(documents[0].deletedAt).toBeNull();
    expect(folder('source').deletedAt).toBeNull();
  });

  it('deletes an empty folder', async () => {
    const { controller, folder, tx } = setup();
    await controller.deleteFolder('unrelated');
    expect(folder('unrelated').deletedAt).toBeInstanceOf(Date);
    expect(tx.folder.updateMany).toHaveBeenCalledOnce();
  });

  it('leaves similarly named folders outside the subtree untouched', async () => {
    const { controller, folders, folder } = setup();
    folders.push({ id: 'collision', name: '2026', parentId: null, path: '/2026', deletedAt: null });
    await controller.deleteFolder('source');
    expect(folder('collision').deletedAt).toBeNull();
    expect(folder('child').deletedAt).toBeInstanceOf(Date);
  });

  it('also deletes live contents below a previously deleted subfolder', async () => {
    const { controller, folder, documents } = setup();
    const previouslyDeletedAt = new Date('2026-01-01');
    folder('child').deletedAt = previouslyDeletedAt;
    await controller.deleteFolder('source');
    expect(folder('child').deletedAt).toEqual(previouslyDeletedAt);
    expect(folder('grandchild').deletedAt).toBeInstanceOf(Date);
    expect(documents[1].deletedAt).toBeInstanceOf(Date);
  });

  it.each(['missing', 'deleted'])('rejects deletion of unavailable folder %s', async (id) => {
    const { controller, tx } = setup();
    await expect(controller.deleteFolder(id)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.folder.updateMany).not.toHaveBeenCalled();
    expect(tx.document.updateMany).not.toHaveBeenCalled();
  });
});

describe('document endpoint permissions', () => {
  function guardContext(handler: 'moveFolder' | 'deleteFolder' | 'moveDocuments' | 'deleteDocuments' | 'preview' | 'updateTitle', isSystemAdmin: boolean, permissions: string[]) {
    const user: AuthUser = { id: 'user', email: 'user@example.com', companyId: null, isSystemAdmin, permissions: [] };
    const rbac = { getPermissions: vi.fn(async () => new Set(permissions)) };
    const guard = new PermissionsGuard(new Reflector(), rbac as unknown as RbacService);
    const context = {
      getHandler: () => DocumentsController.prototype[handler],
      getClass: () => DocumentsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return { guard, context, rbac };
  }

  it.each(['moveFolder', 'deleteFolder', 'moveDocuments', 'deleteDocuments', 'preview', 'updateTitle'] as const)('allows a super admin to call %s without individual grants', async (handler) => {
    const { guard, context, rbac } = guardContext(handler, true, []);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rbac.getPermissions).not.toHaveBeenCalled();
  });

  it.each(['moveFolder', 'deleteFolder', 'moveDocuments', 'deleteDocuments', 'preview', 'updateTitle'] as const)('blocks %s without the required permission', async (handler) => {
    const { guard, context } = guardContext(handler, false, ['documents.folders.read']);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['moveFolder', 'documents.folders.update'],
    ['deleteFolder', 'documents.folders.delete'],
    ['moveDocuments', 'documents.documents.update'],
    ['deleteDocuments', 'documents.documents.delete'],
    ['preview', 'documents.documents.read'],
    ['updateTitle', 'documents.documents.update'],
  ] as const)('allows %s with its required permission', async (handler, permission) => {
    const { guard, context } = guardContext(handler, false, [permission]);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
