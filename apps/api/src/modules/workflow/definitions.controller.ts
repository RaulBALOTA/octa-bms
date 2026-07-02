import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class UpsertDefinitionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() module!: string;
  @IsString() entityType!: string;
  @IsObject() definition!: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateDefinitionDto extends UpsertDefinitionDto {
  @IsOptional() @IsString() declare code: string;
  @IsOptional() @IsString() declare name: string;
  @IsOptional() @IsString() declare module: string;
  @IsOptional() @IsString() declare entityType: string;
  @IsOptional() @IsObject() declare definition: Record<string, unknown>;
}

/** Validates the step-list shape the runtime interpreter expects (docs/06). */
function validateDefinition(definition: Record<string, unknown>) {
  const steps = definition.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new UnprocessableEntityException({
      code: 'WORKFLOW_INVALID',
      message: 'definition.steps must be a non-empty array',
    });
  }
  for (const step of steps) {
    if (typeof step !== 'object' || !step || !('code' in step) || !('type' in step)) {
      throw new UnprocessableEntityException({
        code: 'WORKFLOW_INVALID',
        message: 'each step needs at least { code, type }',
      });
    }
  }
}

@ApiTags('workflow')
@ApiBearerAuth()
@Controller('workflow/definitions')
export class DefinitionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('workflow.definitions.read')
  list() {
    return this.prisma.workflowDefinition.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { instances: true } } },
      orderBy: { code: 'asc' },
    });
  }

  @Post()
  @RequirePermission('workflow.definitions.create')
  create(@Body() dto: UpsertDefinitionDto) {
    validateDefinition(dto.definition);
    return this.prisma.workflowDefinition.create({
      data: { ...dto, definition: dto.definition as object },
    });
  }

  @Patch(':id')
  @RequirePermission('workflow.definitions.update')
  async update(@Param('id') id: string, @Body() dto: UpdateDefinitionDto) {
    if (dto.definition) validateDefinition(dto.definition);
    return this.prisma.workflowDefinition.update({
      where: { id },
      data: {
        ...dto,
        definition: dto.definition as object | undefined,
        version: dto.definition ? { increment: 1 } : undefined,
      },
    });
  }
}
