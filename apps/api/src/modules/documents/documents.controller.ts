import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import type { Response } from 'express';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsDefined, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';

// Local disk storage for development; swap for the S3/MinIO StoragePort in
// production (docs/06). Files land outside the web root and are streamed
// through the API, so document permissions stay enforceable.
const UPLOAD_DIR = join(process.cwd(), 'uploads');

class CreateFolderDto {
  @IsString() name!: string;
  @IsOptional() @IsString() parentId?: string;
}

class MoveFolderDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsString()
  parentId!: string | null;
}

export class BulkDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];
}

export class BulkMoveDocumentsDto extends BulkDocumentsDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsString()
  folderId!: string | null;
}

export class UpdateDocumentTitleDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(250)
  title!: string | null;
}

const PREVIEW_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.png': 'image/png',
};

interface FolderTreeRow {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
}

function folderSubtree(rows: FolderTreeRow[], root: FolderTreeRow) {
  const children = new Map<string, FolderTreeRow[]>();
  for (const row of rows) {
    if (row.parentId) {
      children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
    }
  }
  const subtree = [root];
  const visited = new Set([root.id]);
  for (let i = 0; i < subtree.length; i++) {
    for (const child of children.get(subtree[i].id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      subtree.push(child);
    }
  }
  return subtree;
}

class ListDocumentsQuery extends PageQueryDto {
  @IsOptional() @IsString() folderId?: string;
}

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- folders

  @Get('folders')
  @RequirePermission('documents.folders.read')
  folders(@CompanyId() companyId: string) {
    return this.prisma.folder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        _count: {
          select: {
            documents: { where: { deletedAt: null } },
            children: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { path: 'asc' },
    });
  }

  @Post('folders')
  @RequirePermission('documents.folders.create')
  async createFolder(@CompanyId() companyId: string, @Body() dto: CreateFolderDto) {
    const parent = dto.parentId
      ? await this.prisma.folder.findFirst({ where: { id: dto.parentId, companyId, deletedAt: null } })
      : null;
    if (dto.parentId && !parent) throw new NotFoundException('Parent folder not found');
    return this.prisma.folder.create({
      data: {
        companyId,
        name: dto.name,
        parentId: dto.parentId,
        path: `${parent?.path ?? ''}/${dto.name}`,
      },
    });
  }

  @Patch('folders/:id')
  @RequirePermission('documents.folders.update')
  async moveFolder(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: MoveFolderDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // only this company's tree: folder, destination and name clashes all live in it
      const rows = await tx.folder.findMany({ where: { companyId, deletedAt: null } });
      const folder = rows.find((row) => row.id === id);
      if (!folder) throw new NotFoundException('Folder not found');
      const parent = dto.parentId === null
        ? null
        : rows.find((row) => row.id === dto.parentId);
      if (dto.parentId !== null && !parent) {
        throw new NotFoundException('Destination folder not found');
      }
      const subtree = folderSubtree(rows, folder);
      if (subtree.some((row) => row.id === dto.parentId)) {
        throw new BadRequestException('A folder cannot be moved into itself or a subfolder');
      }
      if (folder.parentId === dto.parentId) return folder;
      if (rows.some((row) => row.parentId === dto.parentId && row.name === folder.name)) {
        throw new ConflictException('A folder with this name already exists at the destination');
      }
      const paths = new Map([[folder.id, `${parent?.path ?? ''}/${folder.name}`]]);
      const moved = await tx.folder.update({
        where: { id },
        data: { parentId: dto.parentId, path: paths.get(id)! },
      });
      // Rebuild descendants by their relationships, not a potentially ambiguous name prefix.
      for (const child of subtree.slice(1)) {
        const path = `${paths.get(child.parentId!)}/${child.name}`;
        paths.set(child.id, path);
        await tx.folder.update({ where: { id: child.id }, data: { path } });
      }
      return moved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  @Delete('folders/:id')
  @RequirePermission('documents.folders.delete')
  async deleteFolder(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Include previously deleted descendants so no live contents can be left behind.
      const rows = await tx.folder.findMany({ where: { companyId } });
      const folder = rows.find((row) => row.id === id && row.deletedAt === null);
      if (!folder) throw new NotFoundException('Folder not found');
      const parent = rows.find((row) => row.id === folder.parentId && row.deletedAt === null);
      const parentId = parent?.id ?? null;
      const deletedFolderIds = folderSubtree(rows, folder).map((row) => row.id);
      const deletedAt = new Date();
      await tx.document.updateMany({
        where: { folderId: { in: deletedFolderIds }, companyId, deletedAt: null },
        data: { deletedAt },
      });
      await tx.folder.updateMany({
        where: { id: { in: deletedFolderIds }, deletedAt: null },
        data: { deletedAt },
      });
      return { deleted: true, parentId, deletedFolderIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // -------------------------------------------------------------- documents

  @Patch(':id/title')
  @RequirePermission('documents.documents.update')
  async updateTitle(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentTitleDto,
  ) {
    const title = dto.title?.trim() || null;
    const result = await this.prisma.document.updateMany({
      where: { id, companyId, deletedAt: null },
      data: { title },
    });
    if (!result.count) throw new NotFoundException('Document not found');
    return { id, title };
  }

  private async assertDocumentsExist(tx: Prisma.TransactionClient, companyId: string, ids: string[]) {
    const documents = await tx.document.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null },
      select: { id: true },
    });
    if (documents.length !== ids.length) {
      throw new NotFoundException('One or more selected documents no longer exist. Refresh the file list.');
    }
  }

  @Post('bulk-move')
  @RequirePermission('documents.documents.update')
  async moveDocuments(@CompanyId() companyId: string, @Body() dto: BulkMoveDocumentsDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDocumentsExist(tx, companyId, dto.ids);
      if (dto.folderId !== null) {
        const folder = await tx.folder.findFirst({ where: { id: dto.folderId, companyId, deletedAt: null } });
        if (!folder) throw new NotFoundException('Destination folder not found');
      }
      const result = await tx.document.updateMany({
        where: { id: { in: dto.ids }, companyId, deletedAt: null },
        data: { folderId: dto.folderId },
      });
      return { moved: result.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  @Post('bulk-delete')
  @RequirePermission('documents.documents.delete')
  async deleteDocuments(@CompanyId() companyId: string, @Body() dto: BulkDocumentsDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDocumentsExist(tx, companyId, dto.ids);
      const result = await tx.document.updateMany({
        where: { id: { in: dto.ids }, companyId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return { deleted: result.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  @Get()
  @RequirePermission('documents.documents.read')
  async list(@CompanyId() companyId: string, @Query() query: ListDocumentsQuery) {
    const where: Prisma.DocumentWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.q
        ? { OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { title: { contains: query.q, mode: 'insensitive' } },
        ] }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: {
          folder: { select: { id: true, name: true, path: true } },
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            select: {
              version: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Post('upload')
  @RequirePermission('documents.documents.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { folderId?: string; documentId?: string },
  ) {
    if (!file) throw new NotFoundException('No file provided');
    if (body.folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: body.folderId, companyId, deletedAt: null } });
      if (!folder) throw new NotFoundException('Folder not found');
    }
    if (body.documentId) {
      const document = await this.prisma.document.findFirst({ where: { id: body.documentId, companyId, deletedAt: null } });
      if (!document) throw new NotFoundException('Document not found');
    }
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

    const storageKey = `${randomUUID()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
    writeFileSync(join(UPLOAD_DIR, storageKey), file.buffer);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    if (body.documentId) {
      // new version of an existing document (check-in)
      const last = await this.prisma.documentVersion.findFirst({
        where: { documentId: body.documentId },
        orderBy: { version: 'desc' },
      });
      const version = (last?.version ?? 0) + 1;
      await this.prisma.documentVersion.create({
        data: {
          documentId: body.documentId,
          version,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          checksum,
          createdById: user.id,
        },
      });
      return this.prisma.document.update({
        where: { id: body.documentId },
        data: { currentVersion: version },
      });
    }

    return this.prisma.document.create({
      data: {
        companyId,
        name: file.originalname,
        folderId: body.folderId || undefined,
        createdById: user.id,
        versions: {
          create: {
            version: 1,
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
            checksum,
            createdById: user.id,
          },
        },
      },
      include: { versions: true },
    });
  }

  @Get(':id/download')
  @RequirePermission('documents.documents.read')
  async download(@CompanyId() companyId: string, @Param('id') id: string, @Res() res: Response) {
    return this.streamDocument(companyId, id, res, false);
  }

  @Get(':id/preview')
  @RequirePermission('documents.documents.read')
  async preview(@CompanyId() companyId: string, @Param('id') id: string, @Res() res: Response) {
    return this.streamDocument(companyId, id, res, true);
  }

  private async streamDocument(companyId: string, id: string, res: Response, inline: boolean) {
    const document = await this.prisma.document.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = document?.versions[0];
    if (!document || !version) throw new NotFoundException();
    const previewMime = PREVIEW_MIME_TYPES[extname(version.fileName).toLowerCase()]
      ?? (Object.values(PREVIEW_MIME_TYPES).includes(version.mimeType) ? version.mimeType : undefined);
    if (inline && !previewMime) {
      throw new UnsupportedMediaTypeException('Preview is available for PDF, JPG, PNG and TIFF files');
    }
    const filePath = join(UPLOAD_DIR, version.storageKey);
    if (!existsSync(filePath)) throw new NotFoundException('File missing on disk');

    res.setHeader('Content-Type', inline ? previewMime! : version.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(version.fileName)}"`,
    );
    const stream = createReadStream(filePath);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
