import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Data = Record<string, unknown>;
const decimal = (value: unknown) => new Prisma.Decimal(String(value ?? '0'));

@Injectable()
export class RecordsFinanceService {
  async prepare(tx: Prisma.TransactionClient, model: string, data: Data, companyId: string) {
    if (model === 'Invoice') {
      const input = data.lines as Data[];
      const codes = await tx.taxCode.findMany({ where: { id: { in: input.map((line) => String(line.taxCodeId)) }, isActive: true } });
      const byId = new Map(codes.map((code) => [code.id, code]));
      let net = decimal(0); let tax = decimal(0);
      const lines = input.map((line, index) => {
        const code = byId.get(String(line.taxCodeId));
        if (!code) throw new BadRequestException('Choose a valid tax code for every invoice line');
        const quantity = decimal(line.quantity ?? '1').toDecimalPlaces(3); const unitPrice = decimal(line.unitPrice).toDecimalPlaces(4);
        if (quantity.lte(0)) throw new BadRequestException('Invoice quantities must be positive');
        const amount = quantity.mul(unitPrice).toDecimalPlaces(2);
        net = net.add(amount); tax = tax.add(amount.mul(code.ratePercent).div(100).toDecimalPlaces(2));
        return { ...line, quantity: quantity.toString(), unitPrice: unitPrice.toFixed(4), position: index + 1, netAmount: amount.toFixed(2) };
      });
      if (data.dueDate instanceof Date && data.invoiceDate instanceof Date && data.dueDate < data.invoiceDate) throw new BadRequestException('Due date must not precede the invoice date');
      Object.assign(data, { netAmount: net.toFixed(2), taxAmount: tax.toFixed(2), grossAmount: net.add(tax).toFixed(2), lines: { create: lines } });
    }
    if (model === 'PurchaseRequest') {
      const items = data.items as Data[];
      let total = decimal(0);
      for (const item of items) {
        const quantity = decimal(item.quantity); const price = decimal(item.estimatedPrice);
        if (quantity.lte(0) || price.lt(0)) throw new BadRequestException('Purchase quantities must be positive and prices cannot be negative');
        total = total.add(quantity.mul(price));
      }
      Object.assign(data, { totalEstimate: total.toFixed(2), items: { create: items } });
    }
    if (model === 'PurchaseOrder') {
      const supplier = await tx.businessPartner.findFirst({ where: { id: String(data.supplierId), companyId, deletedAt: null, type: 'SUPPLIER' } });
      if (!supplier) throw new BadRequestException('Choose a supplier from the active company');
      if (data.requestId) {
        const request = await tx.purchaseRequest.findFirst({ where: { id: String(data.requestId), companyId, deletedAt: null, status: 'APPROVED' } });
        if (!request) throw new BadRequestException('Only an approved purchase request can be linked to an order');
      }
      const items = data.items as Data[];
      let total = decimal(0);
      for (const item of items) {
        const quantity = decimal(item.quantity); const price = decimal(item.unitPrice);
        if (quantity.lte(0) || price.lt(0)) throw new BadRequestException('Order quantities must be positive and prices cannot be negative');
        total = total.add(quantity.mul(price));
      }
      Object.assign(data, { netTotal: total.toFixed(2), items: { create: items } });
    }
    if (model === 'SupplierEvaluation') {
      const ratings = ['quality','delivery','price','communication'].map((key) => Number(data[key]));
      if (ratings.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) throw new BadRequestException('Supplier ratings must be between 1 and 5');
      data.overallScore = ratings.reduce((sum, value) => sum.add(value), decimal(0)).div(4).toFixed(2);
    }
  }

  async reversePayment(tx: Prisma.TransactionClient, id: string, companyId: string) {
    const payment = await tx.payment.findFirst({ where: { id, bankAccount: { companyId, deletedAt: null } }, include: { allocations: true } });
    if (!payment) throw new BadRequestException('Payment not found');
    const reference = `REVERSAL:${payment.id}`;
    if (payment.reference?.startsWith('REVERSAL:') || await tx.payment.findFirst({ where: { reference, bankAccountId: payment.bankAccountId } })) throw new ConflictException('This payment has already been reversed');
    await tx.payment.create({ data: {
      bankAccountId: payment.bankAccountId, paymentDate: new Date(), amount: payment.amount, currencyCode: payment.currencyCode,
      direction: payment.direction === 'IN' ? 'OUT' : 'IN', reference, counterparty: payment.counterparty,
      allocations: { create: payment.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amount: decimal(allocation.amount).negated().toFixed(2) })) },
    } });
    for (const allocation of payment.allocations) {
      const invoice = await tx.invoice.findFirst({ where: { id: allocation.invoiceId, companyId, deletedAt: null } });
      if (!invoice) throw new ConflictException('A linked invoice is unavailable; the reversal was not applied');
      const paid = decimal(invoice.paidAmount).sub(allocation.amount);
      if (paid.lt(0)) throw new ConflictException('The payment cannot be reversed because invoice settlement would become negative');
      const status = ['CANCELLED','DISPUTED'].includes(invoice.status) ? invoice.status : paid.gte(invoice.grossAmount) ? 'PAID' : paid.gt(0) ? 'PARTIALLY_PAID' : invoice.dueDate < new Date() ? 'OVERDUE' : 'SENT';
      await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: paid.toFixed(2), status } });
    }
  }
}
