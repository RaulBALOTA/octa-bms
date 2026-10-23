import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { assertReferenceInCompany, inCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';
import { treeOrder } from '../master-data/cost-centers.controller';
import {
  BUDGET_CATEGORIES,
  BUDGET_GROUPS,
  isRevenueCategory,
  LEGACY_COST,
  VALID_PLAN_CATEGORIES,
} from './budget-structure';

class PlanDto {
  @IsInt() year!: number;
  @IsString() costCenterId!: string;
  @IsIn(VALID_PLAN_CATEGORIES) category!: string;
  @IsNumberString() amount!: string;
  /** 1-12; omitted = annual entry stored on January */
  @IsOptional() @IsInt() @Min(1) @Max(12) month?: number;
  /** both plan and forecast stay editable until the budget is CLOSED */
  @IsOptional() @IsIn(['planned', 'forecast']) field?: string;
}

class StatusDto {
  @IsInt() year!: number;
  @IsIn(['DRAFT', 'APPROVED', 'CLOSED']) status!: string;
}

class CopyDto {
  @IsInt() year!: number;
  /** multiplier applied to the previous year's plan, e.g. 1.05 = +5 % */
  @IsOptional() @IsNumber() @Min(0) @Max(10) factor?: number;
}

const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['DRAFT', 'CLOSED'],
  CLOSED: ['APPROVED'],
};

interface ActualLine {
  costCenterId: string | null;
  budgetCategory: string | null;
  netAmount: unknown;
  invoice: { direction: string; invoiceDate: Date };
}

/**
 * Budget planning after the German GuV/BWA structure (see budget-structure.ts):
 * Kostenarten × cost center × month. Actuals come from posted invoice lines —
 * outgoing lines count as REVENUE (or their explicit revenue Kostenart),
 * incoming lines as their Kostenart, uncategorized incoming as the legacy
 * unallocated bucket. Lifecycle: DRAFT → APPROVED (sign-off marker) → CLOSED
 * (read-only); plan and forecast stay editable until CLOSED.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/budgets')
export class BudgetsController {
  constructor(private readonly prisma: PrismaService) {}

  private budgetFor(companyId: string, year: number) {
    return this.prisma.budget.findFirst({
      where: { companyId, year, deletedAt: null },
      include: { lines: true },
    });
  }

  private actualLines(companyId: string, year: number, costCenterId?: string) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    return this.prisma.invoiceLine.findMany({
      where: {
        costCenterId: costCenterId ?? { not: null },
        invoice: {
          companyId,
          deletedAt: null,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          invoiceDate: { gte: start, lt: end },
        },
      },
      select: {
        costCenterId: true,
        budgetCategory: true,
        netAmount: true,
        invoice: { select: { direction: true, invoiceDate: true } },
      },
    }) as Promise<ActualLine[]>;
  }

  /** Effective Kostenart of a posted line: explicit, else direction default. */
  private lineCategory(line: ActualLine): string {
    if (line.budgetCategory) return line.budgetCategory;
    return line.invoice.direction === 'OUTGOING' ? 'REVENUE' : LEGACY_COST;
  }

  /**
   * Cost centers in tree (DFS) order with all-level descendants. Parents are
   * aggregation-only sum nodes; DFS contiguity makes descendants = the
   * following nodes while depth stays greater.
   */
  private ccTree(
    costCenters: { id: string; code: string; name: string; parentId: string | null }[],
  ) {
    const ordered = treeOrder(costCenters);
    return ordered.map((node, i) => {
      const descendantIds: string[] = [];
      for (let j = i + 1; j < ordered.length && ordered[j].depth > node.depth; j++) {
        descendantIds.push(ordered[j].id);
      }
      return { ...node, descendantIds };
    });
  }

  /** Static Kostenarten catalog for pickers (any authenticated user). */
  @Get('categories')
  categories() {
    return { groups: BUDGET_GROUPS, categories: BUDGET_CATEGORIES };
  }

  /** GuV-ordered planning matrix: Kostenarten rows × cost-center plan columns. */
  @Get('structure')
  @RequirePermission('finance.budgets.read')
  async structure(@CompanyId() companyId: string, @Query('year') yearRaw?: string) {
    const year = Number(yearRaw) || new Date().getFullYear();
    const [costCenters, budget, invoiceLines] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        orderBy: { code: 'asc' },
      }),
      this.budgetFor(companyId, year),
      this.actualLines(companyId, year),
    ]);

    // keep Σ consistent with the visible columns: ignore plans of inactive/deleted CCs
    const activeCcIds = new Set(costCenters.map((c) => c.id));
    const lines = (budget?.lines ?? []).filter((l) => activeCcIds.has(l.costCenterId));
    const tree = this.ccTree(costCenters);
    const buildCategory = (code: string) => {
      const catLines = lines.filter((l) => l.category === code);
      const own: Record<string, { plan: number; forecast: number; phased: boolean }> = {};
      for (const cc of costCenters) {
        const ccLines = catLines.filter((l) => l.costCenterId === cc.id);
        own[cc.id] = {
          plan: ccLines.reduce((s, l) => s + Number(l.plannedAmount), 0),
          forecast: ccLines.reduce(
            (s, l) => s + Number(l.forecastAmount ?? l.plannedAmount),
            0,
          ),
          phased: ccLines.some((l) => l.month > 1 && Number(l.plannedAmount) !== 0),
        };
      }
      // every cell exposes its own editable value; parents additionally roll up
      // their descendants (own + Σ descendants) for the displayed total
      const cells: Record<
        string,
        { plan: number; forecast: number; own: number; ownForecast: number; phased: boolean }
      > = {};
      for (const node of tree) {
        cells[node.id] = {
          plan:
            own[node.id].plan +
            node.descendantIds.reduce((s, d) => s + (own[d]?.plan ?? 0), 0),
          forecast:
            own[node.id].forecast +
            node.descendantIds.reduce((s, d) => s + (own[d]?.forecast ?? 0), 0),
          own: own[node.id].plan,
          ownForecast: own[node.id].forecast,
          phased: own[node.id].phased,
        };
      }
      const planTotal = catLines.reduce((s, l) => s + Number(l.plannedAmount), 0);
      const forecastTotal = catLines.reduce(
        (s, l) => s + Number(l.forecastAmount ?? l.plannedAmount),
        0,
      );
      const actual = invoiceLines
        .filter((l) => this.lineCategory(l) === code)
        .reduce((s, l) => s + Number(l.netAmount), 0);
      return { cells, planTotal, forecastTotal, actual };
    };

    const groups = BUDGET_GROUPS.map((group) => ({
      ...group,
      categories: BUDGET_CATEGORIES.filter((c) => c.group === group.code).map(
        (c) => ({ ...c, ...buildCategory(c.code) }),
      ),
    }));
    // legacy unallocated bucket: pre-structure COST plans + uncategorized incoming actuals
    const legacy = buildCategory(LEGACY_COST);
    const hasLegacy =
      legacy.planTotal !== 0 || legacy.forecastTotal !== 0 || legacy.actual !== 0;

    const sum = (
      type: 'REVENUE' | 'EXPENSE',
      field: 'planTotal' | 'forecastTotal' | 'actual',
    ) =>
      groups
        .filter((g) => g.type === type)
        .flatMap((g) => g.categories)
        .reduce((s, c) => s + c[field], 0) +
      (type === 'EXPENSE' ? legacy[field] : 0);

    const totals = (field: 'planTotal' | 'forecastTotal' | 'actual') => {
      const revenue = sum('REVENUE', field);
      const expense = sum('EXPENSE', field);
      return { revenue, expense, result: revenue - expense };
    };

    return {
      year,
      status: budget?.status ?? 'DRAFT',
      budgetId: budget?.id ?? null,
      budgetName: budget?.name ?? null,
      costCenters: tree.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        depth: c.depth,
        hasChildren: c.hasChildren,
      })),
      groups,
      legacy: hasLegacy ? { code: LEGACY_COST, ...legacy } : null,
      totals: {
        plan: totals('planTotal'),
        forecast: totals('forecastTotal'),
        actual: totals('actual'),
      },
    };
  }

  /** Plan vs. actual per cost center, aggregated over the Kostenarten. */
  @Get('overview')
  @RequirePermission('finance.budgets.read')
  async overview(@CompanyId() companyId: string, @Query('year') yearRaw?: string) {
    const year = Number(yearRaw) || new Date().getFullYear();
    const [costCenters, budget, invoiceLines] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        orderBy: { code: 'asc' },
      }),
      this.budgetFor(companyId, year),
      this.actualLines(companyId, year),
    ]);

    // own values per cost center; parent rows are derived roll-ups afterwards
    const own = new Map(
      costCenters.map((costCenter) => {
        const centerLines =
          budget?.lines.filter((line) => line.costCenterId === costCenter.id) ?? [];
        const planned = (revenue: boolean) =>
          centerLines
            .filter((line) => isRevenueCategory(line.category) === revenue)
            .reduce((sum, line) => sum + Number(line.plannedAmount), 0);
        const forecast = (revenue: boolean) =>
          centerLines
            .filter((line) => isRevenueCategory(line.category) === revenue)
            .reduce(
              (sum, line) => sum + Number(line.forecastAmount ?? line.plannedAmount),
              0,
            );
        const actual = (direction: 'OUTGOING' | 'INCOMING') =>
          invoiceLines
            .filter(
              (line) =>
                line.costCenterId === costCenter.id &&
                line.invoice.direction === direction,
            )
            .reduce((sum, line) => sum + Number(line.netAmount), 0);
        return [
          costCenter.id,
          {
            revenuePlan: planned(true),
            revenueForecast: forecast(true),
            revenueActual: actual('OUTGOING'),
            costPlan: planned(false),
            costForecast: forecast(false),
            costActual: actual('INCOMING'),
          },
        ] as const;
      }),
    );
    type OwnValues = NonNullable<ReturnType<typeof own.get>>;

    const rows = this.ccTree(costCenters).map((node) => {
      const rollup = (key: keyof OwnValues) =>
        own.get(node.id)![key] +
        node.descendantIds.reduce((sum, d) => sum + (own.get(d)?.[key] ?? 0), 0);
      return {
        costCenterId: node.id,
        code: node.code,
        name: node.name,
        depth: node.depth,
        hasChildren: node.hasChildren,
        revenuePlan: rollup('revenuePlan'),
        revenueForecast: rollup('revenueForecast'),
        revenueActual: rollup('revenueActual'),
        costPlan: rollup('costPlan'),
        costForecast: rollup('costForecast'),
        costActual: rollup('costActual'),
      };
    });

    // totals from own values — parent rows already contain their descendants
    const total = (key: keyof OwnValues) =>
      [...own.values()].reduce((sum, v) => sum + v[key], 0);
    return {
      year,
      status: budget?.status ?? 'DRAFT',
      budgetId: budget?.id ?? null,
      budgetName: budget?.name ?? null,
      rows,
      totals: {
        revenuePlan: total('revenuePlan'),
        revenueForecast: total('revenueForecast'),
        revenueActual: total('revenueActual'),
        costPlan: total('costPlan'),
        costForecast: total('costForecast'),
        costActual: total('costActual'),
      },
    };
  }

  /** Monthly phasing of one Kostenart for one cost center. */
  @Get('detail')
  @RequirePermission('finance.budgets.read')
  async detail(
    @CompanyId() companyId: string,
    @Query('year') yearRaw: string,
    @Query('costCenterId') costCenterId: string,
    @Query('category') categoryRaw?: string,
  ) {
    const year = Number(yearRaw) || new Date().getFullYear();
    const category = categoryRaw || 'REVENUE';
    if (!VALID_PLAN_CATEGORIES.includes(category)) {
      throw new UnprocessableEntityException({
        code: 'UNKNOWN_CATEGORY',
        message: `Unknown Kostenart ${category}`,
      });
    }

    const [costCenter, budget, allLines, allCenters] = await Promise.all([
      this.prisma.costCenter.findFirst({
        where: { id: costCenterId, companyId, deletedAt: null },
      }),
      this.budgetFor(companyId, year),
      this.actualLines(companyId, year),
      this.prisma.costCenter.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    if (!costCenter) {
      throw new UnprocessableEntityException({
        code: 'COST_CENTER_NOT_FOUND',
        message: 'Cost center not found',
      });
    }

    const node = this.ccTree(allCenters).find((n) => n.id === costCenterId);
    const hasChildren = (node?.descendantIds.length ?? 0) > 0;
    // the drawer edits this cost center's OWN monthly values; the roll-up across
    // its sub cost centers lives in the overview and is never edited here
    const invoiceLines = allLines.filter((l) => l.costCenterId === costCenterId);

    const lines =
      budget?.lines.filter(
        (l) => l.costCenterId === costCenterId && l.category === category,
      ) ?? [];
    const months = Array.from({ length: 12 }, (_, i) => {
      const monthLines = lines.filter((l) => l.month === i + 1);
      const hasForecast = monthLines.some((l) => l.forecastAmount != null);
      const actual = invoiceLines
        .filter(
          (l) =>
            this.lineCategory(l) === category &&
            l.invoice.invoiceDate.getUTCMonth() === i,
        )
        .reduce((sum, l) => sum + Number(l.netAmount), 0);
      return {
        month: i + 1,
        plan: monthLines.reduce((sum, l) => sum + Number(l.plannedAmount), 0),
        forecast: hasForecast
          ? monthLines.reduce(
              (sum, l) => sum + Number(l.forecastAmount ?? l.plannedAmount),
              0,
            )
          : null,
        actual,
      };
    });

    return {
      year,
      status: budget?.status ?? 'DRAFT',
      category,
      hasChildren,
      costCenter: { id: costCenter.id, code: costCenter.code, name: costCenter.name },
      months,
    };
  }

  @Put('plan')
  @RequirePermission('finance.budgets.update')
  async plan(@CompanyId() companyId: string, @Body() dto: PlanDto) {
    const field = dto.field ?? 'planned';
    await assertReferenceInCompany(dto.costCenterId, 'costCenterId', inCompany(this.prisma, 'costCenter', companyId));
    // any cost center is editable (parents carry their own value alongside the
    // roll-up of their children) and any status stays editable — CLOSED is a
    // marker, not a lock; reopen is still one click but no longer required
    const existing = await this.prisma.budget.findFirst({
      where: { companyId, year: dto.year, deletedAt: null },
    });

    const budget =
      existing ??
      (await this.prisma.budget.create({
        data: { companyId, year: dto.year, name: `Budget ${dto.year}` },
      }));
    // a whole-year figure (no month) is authoritative: it lands on January and
    // supersedes any existing monthly split, so the annual grid can overwrite a
    // cell that was previously phased across months
    const isAnnual = dto.month === undefined;
    const month = dto.month ?? 1;
    const line = await this.prisma.budgetLine.upsert({
      where: {
        budgetId_costCenterId_category_month: {
          budgetId: budget.id,
          costCenterId: dto.costCenterId,
          category: dto.category,
          month,
        },
      },
      update:
        field === 'forecast'
          ? { forecastAmount: dto.amount }
          : { plannedAmount: dto.amount },
      create: {
        budgetId: budget.id,
        costCenterId: dto.costCenterId,
        category: dto.category,
        month,
        plannedAmount: field === 'planned' ? dto.amount : '0',
        forecastAmount: field === 'forecast' ? dto.amount : undefined,
      },
    });
    if (isAnnual) {
      await this.prisma.budgetLine.updateMany({
        where: {
          budgetId: budget.id,
          costCenterId: dto.costCenterId,
          category: dto.category,
          month: { gt: 1 },
        },
        data: field === 'forecast' ? { forecastAmount: null } : { plannedAmount: '0' },
      });
    }
    return line;
  }

  /** DRAFT → APPROVED → CLOSED; only closing locks the numbers. */
  @Post('status')
  @RequirePermission('finance.budgets.approve')
  async setStatus(@CompanyId() companyId: string, @Body() dto: StatusDto) {
    const budget = await this.prisma.budget.findFirst({
      where: { companyId, year: dto.year, deletedAt: null },
    });
    if (!budget) {
      throw new UnprocessableEntityException({
        code: 'BUDGET_NOT_FOUND',
        message: `No budget exists for ${dto.year} yet — enter plan values first`,
      });
    }
    if (!STATUS_TRANSITIONS[budget.status]?.includes(dto.status)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_TRANSITION',
        message: `Cannot go from ${budget.status} to ${dto.status}`,
      });
    }
    return this.prisma.budget.update({
      where: { id: budget.id },
      data: { status: dto.status },
    });
  }

  /** Seeds the target year's plan from the previous year (optionally scaled). */
  @Post('copy')
  @RequirePermission('finance.budgets.update')
  async copy(@CompanyId() companyId: string, @Body() dto: CopyDto) {
    const factor = dto.factor ?? 1;
    const [source, target] = await Promise.all([
      this.budgetFor(companyId, dto.year - 1),
      this.budgetFor(companyId, dto.year),
    ]);
    if (!source || source.lines.length === 0) {
      throw new UnprocessableEntityException({
        code: 'SOURCE_EMPTY',
        message: `No plan values exist for ${dto.year - 1}`,
      });
    }
    if (target?.status === 'CLOSED') {
      throw new UnprocessableEntityException({
        code: 'BUDGET_LOCKED',
        message: `Budget ${dto.year} is ${target.status}`,
      });
    }
    if (target?.lines.some((line) => Number(line.plannedAmount) !== 0)) {
      throw new UnprocessableEntityException({
        code: 'BUDGET_NOT_EMPTY',
        message: `Budget ${dto.year} already has plan values`,
      });
    }

    const budget =
      target ??
      (await this.prisma.budget.create({
        data: { companyId, year: dto.year, name: `Budget ${dto.year}` },
      }));
    // upsert per line (never delete) so pre-existing zero lines are overwritten
    for (const line of source.lines) {
      const plannedAmount = (Number(line.plannedAmount) * factor).toFixed(2);
      await this.prisma.budgetLine.upsert({
        where: {
          budgetId_costCenterId_category_month: {
            budgetId: budget.id,
            costCenterId: line.costCenterId,
            category: line.category,
            month: line.month,
          },
        },
        update: { plannedAmount },
        create: {
          budgetId: budget.id,
          costCenterId: line.costCenterId,
          category: line.category,
          month: line.month,
          plannedAmount,
        },
      });
    }
    return { copied: source.lines.length, factor };
  }
}
