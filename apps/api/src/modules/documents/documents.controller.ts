import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import type { Response } from 'express';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { IsOptional, IsString } from 'class-validator';
import {
  AuthUser,
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
  folders() {
    return this.prisma.folder.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { documents: true, children: true } } },
      orderBy: { path: 'asc' },
    });
  }

  @Post('folders')
  @RequirePermission('documents.folders.create')
  async createFolder(@Body() dto: CreateFolderDto) {
    const parent = dto.parentId
      ? await this.prisma.folder.findUniqueOrThrow({ where: { id: dto.parentId } })
      : null;
    return this.prisma.folder.create({
      data: {
        name: dto.name,
        parentId: dto.parentId,
        path: `${parent?.path ?? ''}/${dto.name}`,
      },
    });
  }

  // -------------------------------------------------------------- documents

  @Get()
  @RequirePermission('documents.documents.read')
  async list(@Query() query: ListDocumentsQuery) {
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.q
        ? { name: { contains: query.q, mode: 'insensitive' } }
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
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { folderId?: string; documentId?: string },
  ) {
    if (!file) throw new NotFoundException('No file provided');
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

    const storageKey = `${randomUUID()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;
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
  async download(@Param('id') id: string, @Res() res: Response) {
    const document = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = document?.versions[0];
    if (!document || !version) throw new NotFoundException();
    const filePath = join(UPLOAD_DIR, version.storageKey);
    if (!existsSync(filePath)) throw new NotFoundException('File missing on disk');

    res.setHeader('Content-Type', version.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(version.fileName)}"`,
    );
    createReadStream(filePath).pipe(res);
  }
}
