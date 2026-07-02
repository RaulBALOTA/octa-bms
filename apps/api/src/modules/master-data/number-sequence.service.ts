import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Gap-free sequential document numbers per company / entity / year
 * (German §14 UStG requirement for invoices). Allocation locks the sequence
 * row, so it must run inside the caller's transaction.
 */
@Injectable()
export class NumberSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    tx: Prisma.TransactionClient,
    companyId: string,
    entityType: string,
    prefix: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await tx.$queryRaw<
      { id: string; lastNumber: number; padding: number }[]
    >`
      SELECT id, "lastNumber", padding FROM number_sequences
      WHERE "companyId" = ${companyId} AND "entityType" = ${entityType} AND year = ${year}
      FOR UPDATE
    `;

    let id: string;
    let nextNumber: number;
    let padding = 5;

    if (rows.length === 0) {
      const created = await tx.numberSequence.create({
        data: { companyId, entityType, prefix, year, lastNumber: 1 },
      });
      id = created.id;
      nextNumber = 1;
      padding = created.padding;
    } else {
      id = rows[0].id;
      nextNumber = rows[0].lastNumber + 1;
      padding = rows[0].padding;
      await tx.numberSequence.update({
        where: { id },
        data: { lastNumber: nextNumber },
      });
    }

    return `${prefix}-${year}-${String(nextNumber).padStart(padding, '0')}`;
  }
}
