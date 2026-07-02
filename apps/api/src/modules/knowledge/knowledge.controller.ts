import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';

const ARTICLE_TYPES = [
  'ARTICLE',
  'STANDARD',
  'PROCEDURE',
  'TEMPLATE',
  'LESSON_LEARNED',
  'FAQ',
] as const;

class UpsertArticleDto {
  @IsString() title!: string;
  @IsString() content!: string;
  @IsOptional() @IsIn([...ARTICLE_TYPES]) type?: string;
  @IsOptional() @IsIn(['de', 'en']) language?: string;
}

class UpdateArticleDto extends UpsertArticleDto {
  @IsOptional() @IsString() declare title: string;
  @IsOptional() @IsString() declare content: string;
}

class ListArticlesQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ARTICLE_TYPES })
  @IsOptional()
  @IsIn([...ARTICLE_TYPES])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'])
  status?: string;
}

@ApiTags('knowledge')
@ApiBearerAuth()
@Controller('knowledge/articles')
export class KnowledgeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('knowledge.articles.read')
  async list(@Query() query: ListArticlesQuery) {
    const where: Prisma.KnowledgeArticleWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { content: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.knowledgeArticle.findMany({
        where,
        select: {
          id: true,
          type: true,
          title: true,
          language: true,
          status: true,
          publishedAt: true,
          viewCount: true,
          updatedAt: true,
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.knowledgeArticle.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Get(':id')
  @RequirePermission('knowledge.articles.read')
  async get(@Param('id') id: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 5 } },
    });
    if (!article) throw new NotFoundException();
    await this.prisma.knowledgeArticle.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
    return article;
  }

  @Post()
  @RequirePermission('knowledge.articles.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: UpsertArticleDto) {
    return this.prisma.knowledgeArticle.create({
      data: {
        title: dto.title,
        content: dto.content,
        type: dto.type ?? 'ARTICLE',
        language: dto.language ?? 'de',
        authorId: user.id,
        createdById: user.id,
      },
    });
  }

  @Patch(':id')
  @RequirePermission('knowledge.articles.update')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    const article = await this.prisma.knowledgeArticle.findUniqueOrThrow({
      where: { id },
    });
    // snapshot the previous content as a version before overwriting
    if (dto.content && dto.content !== article.content) {
      const last = await this.prisma.articleVersion.findFirst({
        where: { articleId: id },
        orderBy: { version: 'desc' },
      });
      await this.prisma.articleVersion.create({
        data: {
          articleId: id,
          version: (last?.version ?? 0) + 1,
          content: article.content,
          createdById: user.id,
        },
      });
    }
    return this.prisma.knowledgeArticle.update({ where: { id }, data: dto });
  }

  @Post(':id/publish')
  @RequirePermission('knowledge.articles.approve')
  async publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const article = await this.prisma.knowledgeArticle.findUniqueOrThrow({
      where: { id },
    });
    if (article.status === 'PUBLISHED') {
      throw new UnprocessableEntityException({
        code: 'ALREADY_PUBLISHED',
        message: 'Article is already published',
      });
    }
    return this.prisma.knowledgeArticle.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), reviewerId: user.id },
    });
  }
}
