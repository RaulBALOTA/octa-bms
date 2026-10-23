import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RecordsFinanceService } from './records-finance.service';

const decimal = (amount: string) => new Prisma.Decimal(amount);
function setup() {
  const tx = {
    taxCode: { findMany: vi.fn(async () => [{ id: 'vat', ratePercent: decimal('19') }]) },
    payment: { findFirst: vi.fn(), create: vi.fn(async () => ({})) },
    invoice: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
  };
  return { service: new RecordsFinanceService(), db: tx as unknown as Prisma.TransactionClient, tx };
}
describe('record finance calculations and reversals', () => {
  it('calculates line tax and totals using decimal arithmetic without losing unit price precision', async () => {
    const { service, db } = setup();
    const data: Record<string, unknown> = { lines: [
      { description: 'Precise rate', quantity: '3', unitPrice: '10.0155', taxCodeId: 'vat' },
      { description: 'Small amount', quantity: '1', unitPrice: '0.1', taxCodeId: 'vat' },
    ] };
    await service.prepare(db, 'Invoice', data, 'company');
    expect(data).toMatchObject({ netAmount: '30.15', taxAmount: '5.73', grossAmount: '35.88',
      lines: { create: [{ position: 1, unitPrice: '10.0155', netAmount: '30.05' }, { position: 2, netAmount: '0.10' }] } });
  });
  it('rejects zero quantities and missing or inactive tax codes', async () => {
    const { service, db, tx } = setup();
    await expect(service.prepare(db, 'Invoice', { lines: [{ quantity: '0', unitPrice: '10', taxCodeId: 'vat' }] }, 'company')).rejects.toThrow('positive');
    tx.taxCode.findMany.mockResolvedValue([]);
    await expect(service.prepare(db, 'Invoice', { lines: [{ quantity: '1', unitPrice: '10', taxCodeId: 'missing' }] }, 'company')).rejects.toThrow('valid tax code');
  });
  it('records an opposite bank movement and undoes invoice allocations', async () => {
    const { service, db, tx } = setup();
    tx.payment.findFirst.mockResolvedValueOnce({ id: 'p', bankAccountId: 'b', direction: 'IN', amount: decimal('30.05'), currencyCode: 'EUR', reference: 'Original', counterparty: 'Customer', allocations: [{ invoiceId: 'i', amount: decimal('30.05') }] }).mockResolvedValueOnce(null);
    tx.invoice.findFirst.mockResolvedValue({ id: 'i', paidAmount: decimal('40.15'), grossAmount: decimal('100'), status: 'PARTIALLY_PAID', dueDate: new Date('2099-01-01') });
    await service.reversePayment(db, 'p', 'company');
    expect(tx.payment.findFirst).toHaveBeenNthCalledWith(1, { where: { id: 'p', bankAccount: { companyId: 'company', deletedAt: null } }, include: { allocations: true } });
    expect(tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: decimal('30.05'), direction: 'OUT', reference: 'REVERSAL:p', allocations: { create: [{ invoiceId: 'i', amount: '-30.05' }] } }) });
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'i' }, data: { paidAmount: '10.10', status: 'PARTIALLY_PAID' } });
  });
  it('refuses to reverse a reversal or a payment already reversed', async () => {
    const { service, db, tx } = setup();
    tx.payment.findFirst.mockResolvedValueOnce({ id: 'r', reference: 'REVERSAL:p', allocations: [] });
    await expect(service.reversePayment(db, 'r', 'company')).rejects.toBeInstanceOf(ConflictException);
    tx.payment.findFirst.mockResolvedValueOnce({ id: 'p', reference: 'Original', allocations: [] }).mockResolvedValueOnce({ id: 'r' });
    await expect(service.reversePayment(db, 'p', 'company')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
  it('rejects a reversal that would make settlement negative', async () => {
    const { service, db, tx } = setup();
    tx.payment.findFirst.mockResolvedValueOnce({ id: 'p', bankAccountId: 'b', direction: 'IN', amount: decimal('30'), allocations: [{ invoiceId: 'i', amount: decimal('30') }] }).mockResolvedValueOnce(null);
    tx.invoice.findFirst.mockResolvedValue({ id: 'i', paidAmount: decimal('20'), grossAmount: decimal('100'), status: 'PARTIALLY_PAID', dueDate: new Date('2099-01-01') });
    await expect(service.reversePayment(db, 'p', 'company')).rejects.toThrow('negative');
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });
  it('recomputes supplier scores and validates the rating range', async () => {
    const { service, db } = setup(); const data = { quality: 2, delivery: 3, price: 4, communication: 5 };
    await service.prepare(db, 'SupplierEvaluation', data, 'company'); expect(data).toMatchObject({ overallScore: '3.50' });
    await expect(service.prepare(db, 'SupplierEvaluation', { ...data, quality: 6 }, 'company')).rejects.toThrow('between 1 and 5');
  });
});
