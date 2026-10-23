import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Resolves a lookup that is already filtered to the active company (e.g.
 * `findFirst({ where: { id, companyId } })` or `{ id, partner: { companyId } }`)
 * and answers 404 when it finds nothing, so records of other companies are
 * indistinguishable from missing ones.
 */
export async function requireInCompany<T>(
  lookup: Promise<T | null>,
  what = 'Record',
): Promise<T> {
  const row = await lookup;
  if (!row) throw new NotFoundException(`${what} not found in the active company`);
  return row;
}

/**
 * Validates an optional foreign key from a request body against the active
 * company. Skips absent values; rejects ids the scoped lookup does not find.
 */
export async function assertReferenceInCompany(
  value: string | null | undefined,
  field: string,
  lookup: (id: string) => Promise<unknown>,
): Promise<void> {
  if (value === undefined || value === null || value === '') return;
  if (!(await lookup(value))) {
    throw new BadRequestException(`Choose a valid ${field} from the active company`);
  }
}

type CompanyModel =
  | 'businessPartner'
  | 'employee'
  | 'contract'
  | 'costCenter'
  | 'bankAccount'
  | 'opportunity';

interface ScopedDelegate {
  findFirst(args: { where: Record<string, unknown>; select: { id: true } }): Promise<unknown>;
}

/** Lookup for `assertReferenceInCompany` on a live company-scoped record. */
export function inCompany(
  prisma: { [K in CompanyModel]: unknown },
  model: CompanyModel,
  companyId: string,
) {
  const delegate = prisma[model] as ScopedDelegate;
  return (id: string) =>
    delegate.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } });
}
