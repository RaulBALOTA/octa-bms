import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * DATEV Buchungsstapel export (EXTF CSV, format version 700).
 * Outgoing invoices post debit 10000 (Debitoren-Sammelkonto) against 8400
 * (Erlöse 19% USt); incoming post 4980 (Aufwand) against 70000 (Kreditoren).
 * Account mapping is intentionally simple — a Kontenrahmen mapping table
 * (SKR03/SKR04 per tax code) replaces it when the Steuerberater confirms the
 * chart of accounts. BU-Schlüssel comes from tax_codes.datevCode.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/datev')
export class DatevController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('pending-count')
  @RequirePermission('finance.datev.export')
  async pendingCount(@CompanyId() companyId: string) {
    const count = await this.prisma.invoice.count({
      where: {
        companyId,
        deletedAt: null,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        datevExportedAt: null,
      },
    });
    return { count };
  }

  @Get('export')
  @RequirePermission('finance.datev.export')
  async export(
    @CompanyId() companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();

    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        invoiceDate: { gte: fromDate, lte: toDate },
      },
      include: {
        partner: { select: { name: true } },
        lines: { include: { taxCode: true }, orderBy: { position: 'asc' } },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const fmtAmount = (value: number) =>
      value.toFixed(2).replace('.', ','); // DATEV uses decimal comma
    const fmtDate = (date: Date) =>
      `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}`;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const now = new Date();
    const timestamp =
      now.toISOString().replace(/[-:T]/g, '').slice(0, 14) + '000';
    const year = fromDate.getFullYear();

    // EXTF header row (format: Buchungsstapel, version 700)
    const header = [
      '"EXTF"', '700', '21', '"Buchungsstapel"', '13', timestamp, '', '""', '""',
      '""', '1', '1', `${year}0101`, '4',
      `${year}${String(fromDate.getMonth() + 1).padStart(2, '0')}${String(fromDate.getDate()).padStart(2, '0')}`,
      `${toDate.getFullYear()}${String(toDate.getMonth() + 1).padStart(2, '0')}${String(toDate.getDate()).padStart(2, '0')}`,
      '"OCTA BMS"', '""', '1', '0', '0', '"EUR"',
    ].join(';');

    const columns =
      'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;' +
      'Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);' +
      'BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext';

    const rows = invoices.flatMap((invoice) =>
      invoice.lines.map((line) => {
        const isOutgoing = invoice.direction === 'OUTGOING';
        const grossLine =
          Number(line.netAmount) * (1 + Number(line.taxCode.ratePercent) / 100);
        return [
          fmtAmount(grossLine),
          isOutgoing ? '"S"' : '"H"',
          '"EUR"',
          '', '', '',
          isOutgoing ? '10000' : '4980',
          isOutgoing ? '8400' : '70000',
          `"${line.taxCode.datevCode ?? ''}"`,
          fmtDate(invoice.invoiceDate),
          quote(invoice.invoiceNumber),
          quote(invoice.externalNumber ?? ''),
          '',
          quote(`${invoice.partner.name} ${line.description}`.slice(0, 60)),
        ].join(';');
      }),
    );

    await this.prisma.invoice.updateMany({
      where: { id: { in: invoices.map((invoice) => invoice.id) } },
      data: { datevExportedAt: now },
    });

    const csv = [header, columns, ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=windows-1252');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="EXTF_Buchungsstapel_${year}.csv"`,
    );
    res.send('﻿' + csv);
  }
}
