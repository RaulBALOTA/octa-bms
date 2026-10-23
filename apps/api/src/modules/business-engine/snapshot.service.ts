import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CommitmentStatus, EngineConfig, EngineSnapshot, FeeModel, ResourceKind, Seniority, SnapshotAssignment, SnapshotResource,
} from '../../../../../packages/shared/src/business-engine';
import { PrismaService } from '../../core/prisma/prisma.service';
import { addMonths, fromDay, monthEnd, toDay } from './domain/calendar';
import { D, Dec, ZERO, dec, money, sum } from './domain/money';
import { EngineSettingsService } from './settings.service';
import { INTERNAL_KINDS } from './dto';
import { isoDate, today } from './access';

const OPEN_AR = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const OPEN_AP = ['IN_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const ACTIVE_CONTRACT = ['ACTIVE', 'RENEWED'];

export interface SnapshotFilters { serviceId?: string; clientId?: string; departmentId?: string }
export interface SnapshotMeta { excluded: { id: string; title: string; reason: string }[]; fxWarnings: string[] }

const assignmentInclude = {
  service: { select: { name: true, code: true, targetMarginPct: true, externalDeliveryAllowed: true, commercialRisk: true, technicalRisk: true, contractualRisk: true, strategicImportance: true } },
  client: { select: { name: true, paymentTermDays: true } },
  contract: { select: { status: true } },
  opportunity: { select: { stage: true, probability: true } },
  responsible: { select: { userId: true, departmentId: true } },
  demands: { orderBy: { sortOrder: 'asc' as const }, include: { skill: { select: { name: true } } } },
  milestones: { orderBy: { dueDate: 'asc' as const } },
  adjustments: true,
  forecasts: { where: { kind: { in: ['CONTRACT_BASELINE', 'APPROVED_BUDGET'] } }, orderBy: { version: 'desc' as const }, take: 5 },
} satisfies Prisma.EngineAssignmentInclude;
export type AssignmentRow = Prisma.EngineAssignmentGetPayload<{ include: typeof assignmentInclude }>;

/** Rough contract revenue estimate used only to split contract-level invoiced amounts between assignments. */
export function estimateRevenue(a: AssignmentRow): Dec {
  const hours = a.demands.filter((d) => d.billable).reduce((s, d) => s.plus(d.hours), ZERO);
  switch (a.feeModel) {
    case 'FIXED_FEE': return dec(a.fixedFee);
    case 'TIME_AND_MATERIALS': return dec(a.hourlyRate).times(hours);
    case 'DAILY_RATE': return dec(a.dailyRate).times(hours).div(dec(a.hoursPerDay ?? 8));
    case 'RETAINER': return dec(a.monthlyRetainer).times(Math.max(1, Math.round((a.endDate.getTime() - a.startDate.getTime()) / (30.44 * 86_400_000))));
    case 'MILESTONE': return sum(a.milestones.map((m) => m.amount));
    case 'CAPEX_PERCENT': return dec(a.capexBasis).times(dec(a.capexPercent)).div(100);
    default: return dec(a.fixedFee).plus(dec(a.hourlyRate).times(hours));
  }
}

@Injectable()
export class SnapshotService {
  constructor(private readonly prisma: PrismaService, private readonly settings: EngineSettingsService) {}

  static readonly include = assignmentInclude;

  async build(companyId: string, options: { asOf?: string; filters?: SnapshotFilters; config?: EngineConfig } = {}): Promise<{ snapshot: EngineSnapshot; meta: SnapshotMeta }> {
    const config = options.config ?? await this.settings.config(companyId);
    const asOf = options.asOf ?? today();
    const horizonEnd = fromDay(monthEnd(addMonths(toDay(asOf), config.horizonMonths - 1)));
    const windowStart = new Date(`${asOf}T00:00:00Z`); const windowEnd = new Date(`${horizonEnd}T00:00:00Z`);
    const meta: SnapshotMeta = { excluded: [], fxWarnings: [] };
    const filters = options.filters ?? {};

    const [skills, resourceRows, assignmentRows, receivables, payables, invoiced, accounts, rates] = await Promise.all([
      this.prisma.skill.findMany({ select: { id: true, name: true, parentId: true } }),
      this.prisma.engineResource.findMany({ where: { companyId, deletedAt: null, status: 'ACTIVE' }, include: {
        rates: true, skills: true, absences: { where: { endDate: { gte: windowStart }, startDate: { lte: windowEnd } } },
        employee: { select: { status: true, exitDate: true, hireDate: true, skills: { select: { skillId: true, level: true } },
          leaveRequests: { where: { status: 'APPROVED', endDate: { gte: windowStart }, startDate: { lte: windowEnd } }, select: { startDate: true, endDate: true, days: true } } } },
      } }),
      this.prisma.engineAssignment.findMany({ where: { companyId, deletedAt: null, status: { not: 'CANCELLED' },
        ...(filters.serviceId ? { serviceId: filters.serviceId } : {}), ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.departmentId ? { responsible: { departmentId: filters.departmentId } } : {}) }, include: assignmentInclude, orderBy: { startDate: 'asc' } }),
      this.prisma.invoice.findMany({ where: { companyId, deletedAt: null, direction: 'OUTGOING', status: { in: [...OPEN_AR] } }, select: { id: true, partnerId: true, grossAmount: true, paidAmount: true, dueDate: true, currencyCode: true } }),
      this.prisma.invoice.findMany({ where: { companyId, deletedAt: null, direction: 'INCOMING', status: { in: [...OPEN_AP] } }, select: { id: true, grossAmount: true, paidAmount: true, dueDate: true, currencyCode: true } }),
      this.prisma.invoice.findMany({ where: { companyId, deletedAt: null, direction: 'OUTGOING', status: { notIn: ['DRAFT', 'CANCELLED'] } }, select: { contractId: true, netAmount: true, invoiceDate: true, currencyCode: true } }),
      this.prisma.bankAccount.findMany({ where: { companyId, deletedAt: null, isActive: true }, select: { currencyCode: true, openingBalance: true, payments: { select: { amount: true, direction: true } } } }),
      this.prisma.exchangeRate.findMany({ orderBy: { validFrom: 'desc' } }),
    ]);

    // Currency conversion through EUR using the latest known rate (ExchangeRate.rateToEUR).
    const latest = new Map<string, Dec>();
    for (const r of rates) if (!latest.has(r.currencyCode)) latest.set(r.currencyCode, new D(r.rateToEUR));
    const toEur = (code: string) => (code === 'EUR' ? new D(1) : latest.get(code) ?? null);
    const convert = (amount: Dec, from: string): Dec | null => {
      if (from === config.currency) return amount;
      const a = toEur(from); const b = toEur(config.currency);
      if (!a || !b || b.isZero()) { meta.fxWarnings.push(`No exchange rate ${from}→${config.currency}`); return null; }
      return amount.times(a).div(b);
    };

    const resources: SnapshotResource[] = resourceRows.map((r) => {
      const kind = r.kind as ResourceKind;
      const internal = INTERNAL_KINDS.has(kind);
      const ended = r.employee && ['TERMINATED', 'RETIRED'].includes(r.employee.status) ? r.employee.exitDate : null;
      const activeTo = [r.activeTo, ended].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const skillsOf = r.employee ? r.employee.skills.map((s) => ({ skillId: s.skillId, level: s.level })) : r.skills.map((s) => ({ skillId: s.skillId, level: s.level }));
      const leave = (r.employee?.leaveRequests ?? []).map((l) => {
        const startDay = toDay(isoDate(l.startDate) as string); const endDay = toDay(isoDate(l.endDate) as string);
        let weekdays = 0; for (let d = startDay; d <= endDay; d++) if ((new Date(d * 86_400_000).getUTCDay() + 6) % 7 < 5) weekdays++;
        return { start: isoDate(l.startDate) as string, end: isoDate(l.endDate) as string, fraction: weekdays ? Math.min(1, Number(l.days) / weekdays) : 1 };
      });
      return { id: r.id, name: r.displayName, kind, internal, weeklyHours: Number(r.weeklyHours), maxAllocationPct: Number(r.maxAllocationPct), nonProjectPct: Number(r.nonProjectPct),
        activeFrom: isoDate(r.activeFrom ?? r.employee?.hireDate ?? null), activeTo: isoDate(activeTo), skills: skillsOf,
        rates: r.rates.map((x) => ({ effectiveFrom: isoDate(x.effectiveFrom) as string, costRate: money(convert(dec(x.costRate), x.currencyCode) ?? dec(x.costRate)), billRate: x.billRate === null ? null : money(dec(x.billRate)),
          monthlyFixedCost: x.monthlyFixedCost === null ? null : money(convert(dec(x.monthlyFixedCost), x.currencyCode) ?? dec(x.monthlyFixedCost)) })),
        absences: [...leave, ...r.absences.map((a) => ({ start: isoDate(a.startDate) as string, end: isoDate(a.endDate) as string, fraction: Number(a.fraction) }))] };
    });

    // invoiced net per contract, split across that contract's assignments by estimated revenue
    const invoicedByContract = new Map<string, Dec>();
    for (const inv of invoiced) if (inv.contractId) {
      const v = convert(dec(inv.netAmount), inv.currencyCode); if (v) invoicedByContract.set(inv.contractId, (invoicedByContract.get(inv.contractId) ?? ZERO).plus(v));
    }
    const contractShares = new Map<string, Dec>();
    for (const a of assignmentRows) if (a.contractId) contractShares.set(a.contractId, (contractShares.get(a.contractId) ?? ZERO).plus(estimateRevenue(a)));

    const assignments: SnapshotAssignment[] = [];
    for (const a of assignmentRows) {
      const stage = a.opportunity?.stage;
      let commitment: CommitmentStatus;
      if (a.status === 'COMPLETED') commitment = 'COMPLETED';
      else if ((a.contract && ACTIVE_CONTRACT.includes(a.contract.status)) || stage === 'WON') commitment = 'CONTRACTED';
      else commitment = 'PIPELINE';
      if (commitment === 'PIPELINE' && (stage === 'LOST' || stage === 'CANCELLED')) { meta.excluded.push({ id: a.id, title: a.title, reason: `Opportunity ${stage}` }); continue; }
      if (commitment === 'PIPELINE' && !a.opportunity && a.probabilityOverride === null) { meta.excluded.push({ id: a.id, title: a.title, reason: 'Not contracted, no opportunity and no approved probability' }); continue; }
      const factor = convert(new D(1), a.currencyCode);
      if (!factor) { meta.excluded.push({ id: a.id, title: a.title, reason: `Missing exchange rate for ${a.currencyCode}` }); continue; }
      const m = (v: Prisma.Decimal | null) => (v === null ? null : money(dec(v).times(factor)));
      const probability = commitment !== 'PIPELINE' ? 1 : (a.probabilityOverride ?? (config.probabilitySource === 'STAGE' && stage ? config.stageProbabilities[stage] ?? 0 : a.opportunity?.probability ?? 0)) / 100;
      const share = a.contractId ? contractShares.get(a.contractId) ?? ZERO : ZERO;
      const invoicedNet = a.contractId && share.gt(0) ? (invoicedByContract.get(a.contractId) ?? ZERO).times(estimateRevenue(a)).div(share) : ZERO;
      const baselineRow = a.forecasts.find((f) => f.kind === 'APPROVED_BUDGET') ?? a.forecasts.find((f) => f.kind === 'CONTRACT_BASELINE');
      const base = baselineRow?.snapshot as { revenue?: string; directCost?: string; hours?: number; marginPct?: number | null } | undefined;
      const risk = [a.service.commercialRisk, a.service.technicalRisk, a.service.contractualRisk].filter((x): x is number => x !== null);
      assignments.push({
        id: a.id, title: a.title, serviceId: a.serviceId, serviceName: a.service.name, serviceCode: a.service.code, packageId: a.packageId, clientId: a.clientId, clientName: a.client.name,
        contractId: a.contractId, opportunityId: a.opportunityId, externalProjectRef: a.externalProjectRef, commitment, probability, exclusiveGroup: a.exclusiveGroup, shiftableWeeks: a.shiftableWeeks,
        start: isoDate(a.startDate) as string, end: isoDate(a.endDate) as string, feeModel: a.feeModel as FeeModel, billing: a.billing as SnapshotAssignment['billing'], currency: config.currency,
        fixedFee: m(a.fixedFee), hourlyRate: m(a.hourlyRate), dailyRate: m(a.dailyRate), hoursPerDay: a.hoursPerDay === null ? null : Number(a.hoursPerDay), monthlyRetainer: m(a.monthlyRetainer),
        capexBasis: m(a.capexBasis), capexPercent: a.capexPercent === null ? null : a.capexPercent.toString(),
        paymentTermDays: a.paymentTermDays ?? a.client.paymentTermDays ?? config.cash.defaultPaymentTermDays, vatRatePct: a.vatRatePct === null ? config.vat.ratePct : Number(a.vatRatePct),
        expenses: { travel: m(a.travelCost) as string, software: m(a.softwareCost) as string, other: m(a.otherCost) as string, subcontractFixed: m(a.subcontractFixedCost) as string },
        milestones: a.milestones.map((x) => ({ id: x.id, title: x.title, date: isoDate(x.dueDate) as string, amount: m(x.amount) as string, invoiced: x.isInvoiced })),
        adjustments: a.adjustments.map((x) => ({ date: isoDate(x.effectiveDate) as string, amount: m(x.amount) as string })),
        demand: a.demands.map((d) => ({ id: d.id, skillId: d.skillId, skillName: d.skill?.name ?? null, role: d.role, seniority: d.seniority as Seniority, hours: Number(d.hours),
          start: isoDate(d.startDate), end: isoDate(d.endDate), resourceId: d.resourceId, sourcing: d.sourcing as 'INTERNAL' | 'EXTERNAL', billable: d.billable,
          costRate: m(d.costRate), externalRate: m(d.externalRate), actualHours: Number(d.actualHours), remainingHours: d.remainingHours === null ? null : Number(d.remainingHours) })),
        actuals: { hours: Number(a.actualHours), cost: m(a.actualCost) as string, revenue: m(a.actualRevenue) as string, invoicedNet: money(invoicedNet), percentComplete: a.percentComplete === null ? null : Number(a.percentComplete) },
        baseline: base && base.revenue !== undefined ? { revenue: base.revenue, directCost: base.directCost ?? '0.00', hours: base.hours ?? 0, marginPct: base.marginPct ?? null } : null,
        targetMarginPct: a.service.targetMarginPct === null ? null : Number(a.service.targetMarginPct), externalDeliveryAllowed: a.service.externalDeliveryAllowed,
        responsibleUserId: a.responsible?.userId ?? null, strategicScore: a.service.strategicImportance, riskScore: risk.length ? Math.max(...risk) : null,
      });
    }

    const open = (rows: { grossAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; currencyCode: string }[]) => rows.map((r) => convert(dec(r.grossAmount).minus(dec(r.paidAmount)), r.currencyCode));
    const arAmounts = open(receivables); const apAmounts = open(payables);
    const historyStart = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth() - 12, 1));
    const byMonth = new Map<string, Dec>();
    for (const inv of invoiced) if (inv.invoiceDate >= historyStart) {
      const v = convert(dec(inv.netAmount), inv.currencyCode); if (!v) continue;
      const key = inv.invoiceDate.toISOString().slice(0, 7); byMonth.set(key, (byMonth.get(key) ?? ZERO).plus(v));
    }
    let bank = ZERO;
    for (const acc of accounts) {
      const balance = acc.payments.reduce((s, p) => s.plus(dec(p.amount).times(p.direction === 'IN' ? 1 : -1)), dec(acc.openingBalance));
      bank = bank.plus(convert(balance, acc.currencyCode) ?? ZERO);
    }
    return {
      snapshot: {
        asOf, horizonStart: asOf, horizonEnd, currency: config.currency, config,
        openingCash: config.cash.openingCashSource === 'MANUAL' ? config.cash.manualOpeningCash : money(bank), openingCashSource: config.cash.openingCashSource,
        skills: skills.map((s) => ({ id: s.id, name: s.name, parentId: s.parentId })), resources, assignments,
        openReceivables: receivables.flatMap((r, i) => (arAmounts[i] && arAmounts[i]?.gt(0) ? [{ id: r.id, clientId: r.partnerId, amount: money(arAmounts[i] as Dec), dueDate: isoDate(r.dueDate) as string }] : [])),
        openPayables: payables.flatMap((r, i) => (apAmounts[i] && apAmounts[i]?.gt(0) ? [{ id: r.id, amount: money(apAmounts[i] as Dec), dueDate: isoDate(r.dueDate) as string }] : [])),
        actualInvoicedByMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, net]) => ({ month, net: money(net) })),
      },
      meta: { ...meta, fxWarnings: [...new Set(meta.fxWarnings)] },
    };
  }
}
