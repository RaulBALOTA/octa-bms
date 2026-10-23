import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetsController } from './budgets.controller';

/** Fake of the PrismaService slice budgets.plan() touches — no DB. */
function makePlanPrisma(existingBudget?: { id: string; status: string } | null) {
  const budgetLine = {
    upsert: vi.fn(async ({ create }: any) => ({ id: 'line-1', ...create })),
    updateMany: vi.fn(async () => ({ count: 11 })),
  };
  const prisma = {
    budget: {
      findFirst: vi.fn(async () => existingBudget ?? null),
      create: vi.fn(async ({ data }: any) => ({ id: 'bud-new', status: 'DRAFT', ...data })),
    },
    budgetLine,
    // cost centers in the fake all belong to the caller's company 'co-1'
    costCenter: {
      findFirst: vi.fn(async ({ where }: any) => (where.companyId === 'co-1' ? { id: where.id } : null)),
    },
  };
  return { prisma, budgetLine };
}

describe('BudgetsController.plan — full editability', () => {
  const company = 'co-1';
  beforeEach(() => vi.clearAllMocks());

  it('accepts a plan value on ANY cost center (no sum-node block)', async () => {
    // a parent cost center id — previously rejected with COST_CENTER_HAS_CHILDREN
    const { prisma, budgetLine } = makePlanPrisma({ id: 'bud-1', status: 'DRAFT' });
    const controller = new BudgetsController(prisma as any);

    await expect(
      controller.plan(company, {
        year: 2026,
        costCenterId: 'parent-cc',
        category: 'OFFICE',
        amount: '1000',
      } as any),
    ).resolves.toBeDefined();
    // it never consults costCenter children — the block is gone
    expect(budgetLine.upsert).toHaveBeenCalledOnce();
  });

  it('still edits a CLOSED budget (CLOSED is a marker, not a lock)', async () => {
    const { prisma, budgetLine } = makePlanPrisma({ id: 'bud-1', status: 'CLOSED' });
    const controller = new BudgetsController(prisma as any);

    await expect(
      controller.plan(company, {
        year: 2026,
        costCenterId: 'cc-1',
        category: 'OFFICE',
        amount: '500',
      } as any),
    ).resolves.toBeDefined();
    expect(budgetLine.upsert).toHaveBeenCalledOnce();
  });

  it('an ANNUAL entry (no month) lands on January and clears months 2-12', async () => {
    const { prisma, budgetLine } = makePlanPrisma({ id: 'bud-1', status: 'DRAFT' });
    const controller = new BudgetsController(prisma as any);

    await controller.plan(company, {
      year: 2026,
      costCenterId: 'cc-1',
      category: 'OFFICE',
      amount: '1200',
    } as any);

    // upsert targets month 1
    expect(budgetLine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          budgetId_costCenterId_category_month: expect.objectContaining({ month: 1 }),
        },
      }),
    );
    // the phasing on later months is wiped for the planned field
    expect(budgetLine.updateMany).toHaveBeenCalledWith({
      where: {
        budgetId: 'bud-1',
        costCenterId: 'cc-1',
        category: 'OFFICE',
        month: { gt: 1 },
      },
      data: { plannedAmount: '0' },
    });
  });

  it('an ANNUAL forecast entry clears later months’ forecast', async () => {
    const { prisma, budgetLine } = makePlanPrisma({ id: 'bud-1', status: 'DRAFT' });
    const controller = new BudgetsController(prisma as any);

    await controller.plan(company, {
      year: 2026,
      costCenterId: 'cc-1',
      category: 'OFFICE',
      amount: '900',
      field: 'forecast',
    } as any);

    expect(budgetLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { forecastAmount: null } }),
    );
  });

  it('a MONTHLY entry (explicit month) does NOT clear other months', async () => {
    const { prisma, budgetLine } = makePlanPrisma({ id: 'bud-1', status: 'DRAFT' });
    const controller = new BudgetsController(prisma as any);

    await controller.plan(company, {
      year: 2026,
      costCenterId: 'cc-1',
      category: 'OFFICE',
      amount: '100',
      month: 6,
    } as any);

    expect(budgetLine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          budgetId_costCenterId_category_month: expect.objectContaining({ month: 6 }),
        },
      }),
    );
    expect(budgetLine.updateMany).not.toHaveBeenCalled();
  });
});

/** Fake of the PrismaService slice budgets.structure() touches. */
function makeStructurePrisma(
  costCenters: { id: string; code: string; name: string; parentId: string | null }[],
  lines: {
    costCenterId: string;
    category: string;
    month: number;
    plannedAmount: number;
    forecastAmount: number | null;
  }[],
) {
  return {
    costCenter: {
      findMany: vi.fn(async () => costCenters.map((c) => ({ ...c, isActive: true }))),
    },
    budget: {
      findFirst: vi.fn(async () => ({ id: 'bud-1', status: 'DRAFT', lines })),
    },
    invoiceLine: { findMany: vi.fn(async () => []) },
  };
}

describe('BudgetsController.structure — own value + roll-up', () => {
  const company = 'co-1';
  // parent P with one child C
  const ccs = [
    { id: 'p', code: 'CC-1', name: 'Parent', parentId: null },
    { id: 'c', code: 'CC-1-1', name: 'Child', parentId: 'p' },
  ];

  const officeCell = (res: any, ccId: string) => {
    for (const g of res.groups) {
      for (const cat of g.categories) {
        if (cat.code === 'OFFICE') return cat.cells[ccId];
      }
    }
    throw new Error('OFFICE category not found');
  };

  beforeEach(() => vi.clearAllMocks());

  it('rolls a parent up as own + Σ descendants while exposing its own value', async () => {
    const prisma = makeStructurePrisma(ccs, [
      { costCenterId: 'p', category: 'OFFICE', month: 1, plannedAmount: 30, forecastAmount: null },
      { costCenterId: 'c', category: 'OFFICE', month: 1, plannedAmount: 100, forecastAmount: 120 },
    ]);
    const controller = new BudgetsController(prisma as any);

    const res = await controller.structure(company, '2026');

    const child = officeCell(res, 'c');
    expect(child).toMatchObject({ plan: 100, own: 100, forecast: 120, ownForecast: 120 });

    const parent = officeCell(res, 'p');
    // own stays the parent's direct value; plan/forecast add the child's
    expect(parent.own).toBe(30);
    expect(parent.plan).toBe(130);
    // parent's own forecast falls back to its plan (no forecast line) → 30; + child 120
    expect(parent.ownForecast).toBe(30);
    expect(parent.forecast).toBe(150);
  });

  it('flags a cost center whose own plan is split across months as phased', async () => {
    const prisma = makeStructurePrisma(ccs, [
      { costCenterId: 'c', category: 'OFFICE', month: 1, plannedAmount: 40, forecastAmount: null },
      { costCenterId: 'c', category: 'OFFICE', month: 7, plannedAmount: 60, forecastAmount: null },
    ]);
    const controller = new BudgetsController(prisma as any);

    const res = await controller.structure(company, '2026');
    const child = officeCell(res, 'c');
    expect(child.own).toBe(100);
    expect(child.phased).toBe(true);
  });
});

describe('BudgetsController.plan — company scope', () => {
  it('rejects a cost center of another company', async () => {
    const { prisma, budgetLine } = makePlanPrisma({ id: 'bud-1', status: 'DRAFT' });
    const controller = new BudgetsController(prisma as any);
    await expect(
      controller.plan('other-co', { year: 2026, costCenterId: 'cc-1', category: 'OFFICE', amount: '1' } as any),
    ).rejects.toThrow(/costCenterId/);
    expect(budgetLine.upsert).not.toHaveBeenCalled();
  });
});
