import { BadRequestException, Injectable } from '@nestjs/common';
import type { EngineSnapshot, PortfolioMode, PortfolioResult, ServiceAttractiveness } from '../../../../../packages/shared/src/business-engine';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../core/auth/decorators';
import { engineCall } from './access';
import { PortfolioQuery, SourcingDto } from './dto';
import { SnapshotService, SnapshotMeta } from './snapshot.service';
import { EngineSettingsService } from './settings.service';
import { computePortfolio } from './domain/portfolio';
import { compareSourcing } from './domain/sourcing';
import { benchmarkServices, recalibrationProposals, scoreServices, stats, type AttractivenessInput, type BenchmarkSample } from './domain/intelligence';
import { applyOperations } from './domain/scenario';
import { ENGINE_VERSION } from './domain/config';
import { dec, money } from './domain/money';

/** Definitions shown next to every cockpit KPI (spec §5.3). */
export const KPI_DEFINITIONS: Record<string, { definition: string; source: string; included: string; excluded: string; basis: string }> = {
  backlog: { definition: 'Remaining revenue (revenue at completion − earned to date) of contracted assignments', source: 'Engine assignments linked to active contracts or won opportunities', included: 'All contracted assignments, full remaining duration', excluded: 'Pipeline, cancelled, completed', basis: 'CONTRACTED' },
  pipelineWeighted: { definition: 'Σ remaining revenue of pipeline assignments × award probability', source: 'Sales opportunities (probability or stage table) and approved overrides', included: 'Open opportunities with service assignments', excluded: 'Lost/cancelled opportunities', basis: 'WEIGHTED' },
  revenue: { definition: 'Revenue earned within the horizon (phased by remaining effort, retainers by days)', source: 'Engine assignments; fee models', included: 'Mode-dependent: contracted, probability-weighted or all-win', excluded: 'Revenue already earned before the as-of date, revenue beyond the horizon', basis: 'FORECAST' },
  directCost: { definition: 'Internal labour (hours × cost rate) + external labour + unfilled-demand cost + project expenses within the horizon', source: 'Demand lines, resource rates, engine settings', included: 'Assignment-attributable costs', excluded: 'Overhead, unabsorbed capacity', basis: 'FORECAST' },
  contribution: { definition: 'Revenue − direct delivery costs', source: 'Calculated', included: 'See revenue and direct cost', excluded: 'Overhead (not EBIT)', basis: 'FORECAST' },
  operatingResult: { definition: 'Contribution − unabsorbed internal capacity cost − configured overhead', source: 'Calculated; overhead from engine settings', included: 'Total internal personnel cost and overhead within the horizon', excluded: 'Interest, taxes, depreciation unless configured as overhead', basis: 'FORECAST' },
  minCash: { definition: 'Lowest forecast closing cash balance within the horizon', source: 'Opening cash (bank accounts or manual), forecast receipts/payments, open AR/AP, VAT settlements', included: 'Operating cash events', excluded: 'Financing, investments, taxes other than VAT', basis: 'FORECAST' },
  peakDeficit: { definition: 'Largest cumulative cash outflow relative to the opening balance (working capital need)', source: 'Cash projection', included: 'All forecast cash events', excluded: '—', basis: 'FORECAST' },
  utilization: { definition: 'Planned project hours of internal resources / available delivery capacity', source: 'Resources (capacity, absences, non-project time), demand lines', included: 'Internal resources', excluded: 'External resources; paid but non-available time', basis: 'FORECAST' },
  shortageHours: { definition: 'Internal demand hours that no qualified available resource can cover', source: 'Weekly greedy allocation (contracted demand first, scarcest skills first)', included: 'Unnamed internal demand', excluded: 'External demand', basis: 'FORECAST' },
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly snapshots: SnapshotService, private readonly settings: EngineSettingsService) {}

  async snapshot(companyId: string, query: PortfolioQuery): Promise<{ snapshot: EngineSnapshot; meta: SnapshotMeta & { scenario?: { id: string; name: string } } }> {
    const built = await this.snapshots.build(companyId, { asOf: query.asOf, filters: { serviceId: query.serviceId, clientId: query.clientId, departmentId: query.departmentId } });
    if (!query.scenarioId) return built;
    const scenario = await this.prisma.engineScenario.findFirst({ where: { id: query.scenarioId, companyId, deletedAt: null }, select: { id: true, name: true, operations: true } });
    if (!scenario) throw new BadRequestException('Scenario not found in this company');
    const applied = engineCall(() => applyOperations(built.snapshot, scenario.operations as never));
    return { snapshot: applied.snapshot, meta: { ...built.meta, scenario: { id: scenario.id, name: scenario.name } } };
  }

  async portfolio(companyId: string, query: PortfolioQuery) {
    const { snapshot, meta } = await this.snapshot(companyId, query);
    const result = engineCall(() => computePortfolio(snapshot, query.mode ?? 'EXPECTED'));
    return { result, meta, definitions: KPI_DEFINITIONS };
  }

  /** Capacity view without any money (for resource and project managers without cost access). */
  async capacity(companyId: string, query: PortfolioQuery) {
    const { snapshot, meta } = await this.snapshot(companyId, query);
    const r = engineCall(() => computePortfolio(snapshot, query.mode ?? 'EXPECTED'));
    return { engineVersion: r.engineVersion, asOf: r.asOf, mode: r.mode, calculatedAt: r.calculatedAt, weeks: r.weeks, months: r.months, capacity: r.capacity,
      totals: { internalHours: r.totals.internalHours, availableHours: r.totals.availableHours, utilization: r.totals.utilization, shortageHours: r.totals.shortageHours },
      assignments: r.assignments.map((a) => ({ id: a.id, title: a.title, serviceName: a.serviceName, clientName: a.clientName, commitment: a.commitment, probability: a.probability, start: a.start, end: a.end,
        plannedHours: a.plannedHours, remainingHours: a.remainingHours, internalHours: a.internalHours, externalHours: a.externalHours, shortageHours: a.shortageHours })),
      meta };
  }

  async overview(companyId: string, query: PortfolioQuery) {
    const { snapshot, meta } = await this.snapshot(companyId, query);
    const mode = query.mode ?? 'EXPECTED';
    const [current, contracted] = engineCall(() => [computePortfolio(snapshot, mode), mode === 'CONTRACTED' ? null : computePortfolio(snapshot, 'CONTRACTED')]);
    const [openAlerts, recommendations] = await Promise.all([
      this.prisma.engineAlert.groupBy({ by: ['severity'], where: { companyId, status: { not: 'RESOLVED' } }, _count: true }),
      this.prisma.engineRecommendation.findMany({ where: { companyId, status: 'PROPOSED' }, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], take: 6,
        select: { id: true, title: true, priority: true, source: true, confidence: true, responsibleRole: true, createdAt: true } }),
    ]);
    const services = [...current.byService];
    return {
      result: current, contracted: contracted ? { totals: contracted.totals, cash: { minBalance: contracted.cash.minBalance, minBalanceDate: contracted.cash.minBalanceDate, peakDeficit: contracted.cash.peakDeficit } } : null,
      topServices: services.slice(0, 5), underperformingServices: services.filter((s) => s.marginPct === null || s.marginPct < 15).sort((a, b) => (a.marginPct ?? -999) - (b.marginPct ?? -999)).slice(0, 5),
      alerts: Object.fromEntries(openAlerts.map((a) => [a.severity, a._count])), recommendations, definitions: KPI_DEFINITIONS, meta,
    };
  }

  /* ---------------------------------------------------------------- benchmarks, attractiveness */
  async samples(companyId: string): Promise<BenchmarkSample[]> {
    const rows = await this.prisma.engineAssignment.findMany({ where: { companyId, deletedAt: null, status: 'COMPLETED' }, select: { id: true, serviceId: true, startDate: true, endDate: true, actualHours: true, actualCost: true, updatedAt: true,
      forecasts: { orderBy: { version: 'asc' }, select: { kind: true, snapshot: true, createdAt: true } } } });
    return rows.flatMap((a) => {
      const plan = a.forecasts.find((f) => f.kind === 'APPROVED_BUDGET') ?? a.forecasts.find((f) => f.kind === 'CONTRACT_BASELINE') ?? a.forecasts.find((f) => f.kind === 'ESTIMATE');
      const actual = [...a.forecasts].reverse().find((f) => f.kind === 'ACTUAL');
      if (!plan) return [];
      const p = plan.snapshot as { hours?: number; directCost?: string; marginPct?: number | null };
      const x = actual?.snapshot as { hours?: number; directCost?: string; marginPct?: number | null; actualHours?: number } | undefined;
      const days = Math.max(1, (a.endDate.getTime() - a.startDate.getTime()) / 86_400_000);
      return [{ serviceId: a.serviceId, assignmentId: a.id, plannedHours: p.hours ?? 0, actualHours: x?.actualHours ?? Number(a.actualHours), plannedCost: Number(p.directCost ?? 0),
        actualCost: x?.directCost !== undefined ? Number(x.directCost) : Number(a.actualCost), plannedDays: days, actualDays: days,
        plannedMarginPct: p.marginPct ?? null, actualMarginPct: x?.marginPct ?? null, completedAt: (actual?.createdAt ?? a.updatedAt).toISOString() }];
    });
  }

  async benchmarks(companyId: string) {
    const [services, samples, config] = await Promise.all([
      this.prisma.engineService.findMany({ where: { companyId, deletedAt: null }, select: { id: true, code: true, name: true } }), this.samples(companyId), this.settings.config(companyId)]);
    return { benchmarks: benchmarkServices(services, samples, config), minSamples: config.benchmarks.minSamples, note: 'Planned durations are taken from assignment dates; duration ratios become meaningful once the PMO reports actual dates.' };
  }

  async attractiveness(companyId: string): Promise<{ scores: ServiceAttractiveness[]; calculatedAt: string; illustrativeConfig: boolean }> {
    const [{ snapshot }, services, samples] = await Promise.all([this.snapshots.build(companyId),
      this.prisma.engineService.findMany({ where: { companyId, deletedAt: null }, include: { assignments: { where: { deletedAt: null, opportunityId: { not: null } }, select: { opportunity: { select: { id: true, stage: true } } } } } }),
      this.samples(companyId)]);
    const result = engineCall(() => computePortfolio(snapshot, 'EXPECTED'));
    const benchmarks = new Map(benchmarkServices(services, samples, snapshot.config).map((b) => [b.serviceId, b]));
    const inputs: AttractivenessInput[] = services.map((s) => {
      const rows = result.assignments.filter((a) => a.serviceId === s.id && a.commitment !== 'COMPLETED');
      const rev = rows.reduce((t, a) => t.plus(dec(a.revenue).times(a.weight)), dec(0)); const con = rows.reduce((t, a) => t.plus(dec(a.contribution).times(a.weight)), dec(0));
      const internalH = rows.reduce((t, a) => t + (a.internalHours + a.actualHours) * a.weight, 0); const externalH = rows.reduce((t, a) => t + a.externalHours * a.weight, 0);
      const peak = rows.reduce((t, a) => t.plus(dec(a.cash.peakFinancingNeed).times(a.weight)), dec(0));
      const opps = new Map(s.assignments.filter((a) => a.opportunity).map((a) => [a.opportunity?.id as string, a.opportunity?.stage]));
      const won = [...opps.values()].filter((x) => x === 'WON').length; const lost = [...opps.values()].filter((x) => x === 'LOST').length;
      const own = samples.filter((x) => x.serviceId === s.id && x.actualMarginPct !== null);
      return { serviceId: s.id, code: s.code, name: s.name, lifecycle: s.lifecycle, completedSamples: benchmarks.get(s.id)?.sampleCount ?? 0, decidedOpportunities: won + lost,
        historicalMarginPct: own.length ? stats(own.map((x) => x.actualMarginPct as number)).median : null,
        forecastMarginPct: rev.gt(0) ? Math.round(con.div(rev).toNumber() * 10000) / 100 : null, targetMarginPct: s.targetMarginPct === null ? null : Number(s.targetMarginPct),
        cashRatio: rev.gt(0) ? peak.div(rev).toNumber() : null, contributionPerHour: internalH > 0 ? con.div(internalH).toNumber() : null,
        weightedPipeline: rows.filter((a) => a.commitment === 'PIPELINE').reduce((t, a) => t + Number(a.remainingRevenue) * a.probability, 0) || null,
        winRate: won + lost > 0 ? won / (won + lost) : null, externalShare: internalH + externalH > 0 ? externalH / (internalH + externalH) : null, effortCv: benchmarks.get(s.id)?.effortRatio.cv ?? null,
        assessments: { repeatability: s.repeatability, scalability: s.scalability, crossSelling: s.crossSelling, strategicImportance: s.strategicImportance, referenceValue: s.referenceValue,
          commercialRisk: s.commercialRisk, technicalRisk: s.technicalRisk } };
    });
    return { scores: scoreServices(inputs, snapshot.config), calculatedAt: result.calculatedAt, illustrativeConfig: result.illustrativeConfig };
  }

  /** Persists a score snapshot per service (score version history). */
  async recordScores(companyId: string, user: AuthUser) {
    const [{ scores }, settings] = await Promise.all([this.attractiveness(companyId), this.settings.get(companyId)]);
    const rows = scores.filter((s) => s.total !== null);
    await this.prisma.engineServiceScore.createMany({ data: rows.map((s) => ({ serviceId: s.serviceId, scores: JSON.parse(JSON.stringify(s)), total: s.total as number, confidence: s.confidence, configVersion: settings.version, createdById: user.id })) });
    return { recorded: rows.length };
  }
  scoreHistory(companyId: string, serviceId: string) {
    return this.prisma.engineServiceScore.findMany({ where: { serviceId, service: { companyId } }, orderBy: { createdAt: 'desc' }, take: 50, select: { total: true, confidence: true, configVersion: true, createdAt: true } });
  }

  async recalibrationCandidates(companyId: string) {
    const [services, samples, config] = await Promise.all([
      this.prisma.engineService.findMany({ where: { companyId, deletedAt: null }, select: { id: true, code: true, name: true, requirements: { select: { typicalHours: true } } } }),
      this.samples(companyId), this.settings.config(companyId)]);
    const benchmarks = benchmarkServices(services, samples, config);
    const templates = new Map(services.map((s) => [s.id, s.requirements.reduce((t, r) => t + Number(r.typicalHours), 0)]));
    return recalibrationProposals(benchmarks, templates, samples, config);
  }

  async sourcing(companyId: string, dto: SourcingDto) {
    const config = await this.settings.config(companyId);
    return engineCall(() => compareSourcing(dto, config));
  }

  /* ---------------------------------------------------------------- reports (CSV) */
  async report(companyId: string, code: string, query: PortfolioQuery): Promise<{ filename: string; csv: string }> {
    const mode: PortfolioMode = query.mode ?? 'EXPECTED';
    const { result, meta } = await this.portfolio(companyId, { ...query, mode });
    const header = (title: string, r: PortfolioResult) => [
      [`# ${title}`], [`# Generated`, r.calculatedAt], [`# Engine version`, ENGINE_VERSION], [`# As of`, r.asOf], [`# Horizon`, `${r.months[0]?.start} – ${r.months.at(-1)?.end}`],
      [`# Data status`, `${mode} (${mode === 'CONTRACTED' ? 'contracted only' : mode === 'EXPECTED' ? 'pipeline probability-weighted' : 'all opportunities won'})`],
      [`# Currency`, r.currency], [`# Settings`, r.illustrativeConfig ? 'ILLUSTRATIVE defaults — not confirmed' : 'Confirmed'],
      ...(meta.scenario ? [[`# Scenario`, meta.scenario.name]] : []), ...(meta.excluded.length ? [[`# Excluded assignments`, String(meta.excluded.length)]] : []), [],
    ];
    let title: string; let rows: (string | number | null)[][];
    switch (code) {
      case 'service-profitability': title = 'Service profitability'; rows = [['Service', 'Revenue', 'Direct cost', 'Contribution', 'Margin %', 'Hours', 'Assignments'],
        ...result.byService.map((s) => [s.name, s.revenue, s.directCost, s.contribution, s.marginPct, s.hours, s.count])]; break;
      case 'project-profitability': title = 'Assignment (project service) profitability'; rows = [['Assignment', 'Client', 'Service', 'Commitment', 'Probability', 'Revenue', 'Cost at completion', 'Contribution', 'Margin %', 'Allocated overhead', 'Operating result', 'Hours at completion', 'Baseline margin %', 'Margin variance pts'],
        ...result.assignments.map((a) => [a.title, a.clientName, a.serviceName, a.commitment, a.probability, a.revenue, a.costAtCompletion, a.contribution, a.marginPct, a.allocatedOverhead, a.operatingResult, a.hoursAtCompletion, a.baselineMarginPct, a.marginVariancePts])]; break;
      case 'financial-forecast': title = 'Financial forecast (P&L)'; rows = [['Month', 'Revenue contracted', 'Revenue pipeline (weighted)', 'External cost', 'Internal applied', 'Contribution', 'Capacity cost', 'Unabsorbed capacity', 'Overhead', 'Operating result', 'Actual invoiced'],
        ...result.pnl.map((p) => [p.key, p.revenueContracted, p.revenuePipeline, p.externalCost, p.internalApplied, p.contribution, p.capacityCost, p.unabsorbedCapacity, p.overhead, p.operatingResult, p.actualInvoiced])]; break;
      case 'cash-flow': title = 'Cash-flow forecast'; rows = [['Month', 'Receipts', 'Payments', 'VAT', 'Net', 'Closing balance', 'Basis'], ...result.cash.months.map((m) => [m.key, m.receipts, m.payments, m.vat, m.net, m.closing, m.basis])]; break;
      case 'resource-utilization': title = 'Resource utilization'; rows = [['Resource', 'Kind', 'Nominal h', 'Absence h', 'Non-project h', 'Available h', 'Planned h', 'Billable h', 'Utilization', 'Billable utilization'],
        ...result.capacity.resources.map((r) => [r.name, r.kind, r.totals.nominal, r.totals.absence, r.totals.nonProject, r.totals.available, r.totals.planned, r.totals.billable, r.totals.utilization, r.totals.billableUtilization])]; break;
      case 'capacity-gaps': title = 'Capacity gaps'; rows = [['Kind', 'Resource/skill', 'Month', 'Excess or missing hours', 'Assignments'], ...result.capacity.bottlenecks.map((b) => [b.kind, b.name, b.periodKey, b.excessHours, b.assignmentIds.length])]; break;
      default: throw new BadRequestException(`Unknown report ${code}`);
    }
    const csv = [...header(title, result), ...rows].map((r) => r.map((v) => csvCell(v)).join(';')).join('\r\n');
    return { filename: `octa-engine-${code}-${result.asOf}-${mode.toLowerCase()}.csv`, csv: `﻿${csv}\r\n` };
  }
}

/** Semicolon CSV (German Excel default); neutralises formula injection. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export const REPORTS = ['service-profitability', 'project-profitability', 'financial-forecast', 'cash-flow', 'resource-utilization', 'capacity-gaps'];
