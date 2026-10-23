import { UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CostCentersController } from './cost-centers.controller';

/**
 * Hermetic fake of the slice of PrismaService the controller touches — no DB.
 * `costCenter.findFirst` is called three ways in create(); we disambiguate by
 * the shape of the `where` clause it receives.
 */
function makePrisma(state: {
  clash?: unknown; // assertCodeFree lookup
  parent?: unknown; // findParent lookup
  buried?: unknown; // soft-deleted same-code lookup
  parentBudgetLines?: number;
  parentInvoiceLines?: number;
}) {
  const tx = {
    costCenter: {
      create: vi.fn(async ({ data }: any) => ({ id: 'new-cc', ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    budgetLine: { updateMany: vi.fn(async () => ({ count: 0 })) },
    invoiceLine: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    costCenter: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.deletedAt && typeof where.deletedAt === 'object') return state.buried ?? null;
        if (where.id) return state.parent ?? null;
        return state.clash ?? null;
      }),
    },
    budgetLine: { count: vi.fn(async () => state.parentBudgetLines ?? 0) },
    invoiceLine: { count: vi.fn(async () => state.parentInvoiceLines ?? 0) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, tx };
}

describe('CostCentersController.create — sub cost center under a value-carrying parent', () => {
  const company = 'co-1';
  const parent = { id: 'cc-root', code: 'CC-100', companyId: company, parentId: null };

  beforeEach(() => vi.clearAllMocks());

  it('re-points the parent’s budget and invoice lines onto the new sub-CC', async () => {
    const { prisma, tx } = makePrisma({ parent, parentBudgetLines: 4, parentInvoiceLines: 2 });
    const controller = new CostCentersController(prisma as any);

    const child = await controller.create(company, {
      code: 'CC-110',
      name: 'Frontend',
      parentId: parent.id,
    } as any);

    expect(child).toMatchObject({ id: 'new-cc', code: 'CC-110', parentId: parent.id });
    // values moved from the parent onto the freshly created leaf
    expect(tx.budgetLine.updateMany).toHaveBeenCalledWith({
      where: { costCenterId: parent.id },
      data: { costCenterId: 'new-cc' },
    });
    expect(tx.invoiceLine.updateMany).toHaveBeenCalledWith({
      where: { costCenterId: parent.id },
      data: { costCenterId: 'new-cc' },
    });
    // the whole thing runs in one transaction
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('does not move anything when the parent carries no own values', async () => {
    const { prisma, tx } = makePrisma({ parent, parentBudgetLines: 0, parentInvoiceLines: 0 });
    const controller = new CostCentersController(prisma as any);

    await controller.create(company, {
      code: 'CC-110',
      name: 'Frontend',
      parentId: parent.id,
    } as any);

    expect(tx.budgetLine.updateMany).not.toHaveBeenCalled();
    expect(tx.invoiceLine.updateMany).not.toHaveBeenCalled();
    expect(tx.costCenter.create).toHaveBeenCalledOnce();
  });

  it('rejects a non-existent parent', async () => {
    const { prisma } = makePrisma({ parent: null, parentBudgetLines: 5 });
    const controller = new CostCentersController(prisma as any);

    await expect(
      controller.create(company, { code: 'CC-110', name: 'x', parentId: 'ghost' } as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('CostCentersController.update — reparent guard is unchanged', () => {
  const company = 'co-1';
  const parent = { id: 'cc-root', code: 'CC-100', companyId: company, parentId: null };

  beforeEach(() => vi.clearAllMocks());

  it('still blocks reparenting under a value-carrying parent (PARENT_HAS_VALUES)', async () => {
    // find() (the node being edited) + findParent() both go through costCenter.findFirst;
    // both return a row here, and the parent reports own values → guard must throw.
    const { prisma } = makePrisma({ parent, clash: null, parentBudgetLines: 3 });
    prisma.costCenter.findFirst = vi.fn(async () => parent) as any;
    const controller = new CostCentersController(prisma as any);

    await expect(
      controller.update(company, 'cc-child', { parentId: parent.id } as any),
    ).rejects.toMatchObject({ response: { code: 'PARENT_HAS_VALUES' } });
  });
});
