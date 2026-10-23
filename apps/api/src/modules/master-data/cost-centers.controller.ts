import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class CreateCostCenterDto {
  @IsString() @MinLength(1) @MaxLength(20) code!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @ValidateIf((o) => o.parentId !== null) @IsString() parentId?: string | null;
}

class UpdateCostCenterDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @ValidateIf((o) => o.parentId !== null) @IsString() parentId?: string | null;
}

interface CcNode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  parentId: string | null;
}

/** flat rows → DFS order (children under parent, siblings by code) with depth */
export function treeOrder<T extends { id: string; code: string; parentId: string | null }>(
  rows: T[],
): (T & { depth: number; hasChildren: boolean })[] {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), row]);
  }
  const out: (T & { depth: number; hasChildren: boolean })[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) =>
      a.code.localeCompare(b.code),
    );
    for (const child of children) {
      out.push({ ...child, depth, hasChildren: byParent.has(child.id) });
      visit(child.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

@ApiTags('master-data')
@ApiBearerAuth()
@Controller('master/cost-centers')
export class CostCentersController {
  constructor(private readonly prisma: PrismaService) {}

  private async find(companyId: string, id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    return costCenter;
  }

  private async assertCodeFree(companyId: string, code: string, excludeId?: string) {
    const clash = await this.prisma.costCenter.findFirst({
      where: {
        companyId,
        code,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new UnprocessableEntityException({
        code: 'CODE_TAKEN',
        message: `Cost center code ${code} already exists`,
      });
    }
  }

  private async findParent(companyId: string, parentId: string) {
    const parent = await this.prisma.costCenter.findFirst({
      where: { id: parentId, companyId, deletedAt: null },
    });
    if (!parent) {
      throw new UnprocessableEntityException({
        code: 'PARENT_NOT_FOUND',
        message: 'Parent cost center not found',
      });
    }
    return parent;
  }

  private async assertNoCycle(
    companyId: string,
    parent: { id: string; parentId: string | null },
    selfId: string,
  ) {
    // walking up from the proposed parent must never reach the node itself
    let cursor: { id: string; parentId: string | null } | null = parent;
    while (cursor) {
      if (cursor.id === selfId) {
        throw new UnprocessableEntityException({
          code: 'CC_CYCLE',
          message: 'Cost center cannot be its own ancestor',
        });
      }
      cursor = cursor.parentId
        ? await this.prisma.costCenter.findFirst({
            where: { id: cursor.parentId, companyId },
            select: { id: true, parentId: true },
          })
        : null;
    }
  }

  /** Does the cost center carry its own plan or posted-invoice values? */
  private async carriesOwnValues(costCenterId: string) {
    const [budgetLines, invoiceLines] = await Promise.all([
      this.prisma.budgetLine.count({
        where: {
          costCenterId,
          OR: [{ plannedAmount: { not: 0 } }, { forecastAmount: { not: null } }],
        },
      }),
      this.prisma.invoiceLine.count({ where: { costCenterId } }),
    ]);
    return budgetLines + invoiceLines > 0;
  }

  private async assertValidParent(companyId: string, parentId: string, selfId?: string) {
    const parent = await this.findParent(companyId, parentId);
    if (selfId) await this.assertNoCycle(companyId, parent, selfId);
    // aggregation-only parents: a node carrying its own values cannot become a sum node
    if (await this.carriesOwnValues(parentId)) {
      throw new UnprocessableEntityException({
        code: 'PARENT_HAS_VALUES',
        message: `Cost center ${parent.code} carries its own plan or invoice values — move them to a sub cost center first`,
      });
    }
    return parent;
  }

  @Get()
  @RequirePermission('finance.budgets.read')
  async list(@CompanyId() companyId: string) {
    const [rows, usedByBudget, usedByInvoice] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { code: 'asc' },
      }),
      this.prisma.budgetLine.groupBy({
        by: ['costCenterId'],
        where: {
          OR: [{ plannedAmount: { not: 0 } }, { forecastAmount: { not: null } }],
        },
      }),
      this.prisma.invoiceLine.groupBy({
        by: ['costCenterId'],
        where: { costCenterId: { not: null } },
      }),
    ]);
    const used = new Set([
      ...usedByBudget.map((u) => u.costCenterId),
      ...usedByInvoice.map((u) => u.costCenterId),
    ]);
    return treeOrder<CcNode>(
      rows.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        description: c.description,
        isActive: c.isActive,
        parentId: c.parentId,
      })),
    ).map((c) => ({ ...c, inUse: used.has(c.id) }));
  }

  @Post()
  @RequirePermission('finance.budgets.update')
  async create(@CompanyId() companyId: string, @Body() dto: CreateCostCenterDto) {
    await this.assertCodeFree(companyId, dto.code);
    // a new child can never be an ancestor, so only the parent's existence matters
    if (dto.parentId) await this.findParent(companyId, dto.parentId);
    // giving a value-carrying parent its first child turns it into a Σ node; its own
    // plan/invoice values move onto the new leaf so parent totals stay identical and
    // the values become editable again (leaf entry is blocked on sum nodes)
    const inheritsParentValues =
      dto.parentId != null && (await this.carriesOwnValues(dto.parentId));
    // a soft-deleted row with the same code would violate @@unique(companyId, code) — revive it
    const buried = await this.prisma.costCenter.findFirst({
      where: { companyId, code: dto.code, deletedAt: { not: null } },
    });
    return this.prisma.$transaction(async (tx) => {
      const child = buried
        ? await tx.costCenter.update({
            where: { id: buried.id },
            data: {
              name: dto.name,
              description: dto.description ?? null,
              parentId: dto.parentId ?? null,
              isActive: true,
              deletedAt: null,
            },
          })
        : await tx.costCenter.create({
            data: {
              companyId,
              code: dto.code,
              name: dto.name,
              description: dto.description,
              parentId: dto.parentId ?? null,
            },
          });
      if (inheritsParentValues) {
        await tx.budgetLine.updateMany({
          where: { costCenterId: dto.parentId! },
          data: { costCenterId: child.id },
        });
        await tx.invoiceLine.updateMany({
          where: { costCenterId: dto.parentId! },
          data: { costCenterId: child.id },
        });
      }
      return child;
    });
  }

  @Patch(':id')
  @RequirePermission('finance.budgets.update')
  async update(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCostCenterDto,
  ) {
    await this.find(companyId, id);
    if (dto.code) await this.assertCodeFree(companyId, dto.code, id);
    if (dto.parentId) await this.assertValidParent(companyId, dto.parentId, id);
    return this.prisma.costCenter.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
      },
    });
  }

  @Delete(':id')
  @RequirePermission('finance.budgets.update')
  async remove(@CompanyId() companyId: string, @Param('id') id: string) {
    await this.find(companyId, id);
    const [meaningfulBudgetLines, invoiceLines, children] = await Promise.all([
      this.prisma.budgetLine.count({
        where: {
          costCenterId: id,
          OR: [{ plannedAmount: { not: 0 } }, { forecastAmount: { not: null } }],
        },
      }),
      this.prisma.invoiceLine.count({ where: { costCenterId: id } }),
      this.prisma.costCenter.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (children > 0) {
      throw new UnprocessableEntityException({
        code: 'COST_CENTER_HAS_CHILDREN',
        message: 'Cost center has sub cost centers — remove or reassign them first',
      });
    }
    if (meaningfulBudgetLines + invoiceLines > 0) {
      throw new UnprocessableEntityException({
        code: 'COST_CENTER_IN_USE',
        message:
          'Cost center is referenced by budget or invoice lines — deactivate it instead',
      });
    }
    // leftover zero-amount plan rows carry no information and would block the unique code forever
    await this.prisma.budgetLine.deleteMany({
      where: { costCenterId: id, plannedAmount: 0, forecastAmount: null },
    });
    await this.prisma.costCenter.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, parentId: null },
    });
    return { deleted: true };
  }
}
