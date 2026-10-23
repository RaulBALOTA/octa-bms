import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PortfolioMode } from '../../../../../packages/shared/src/business-engine';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../core/auth/decorators';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { can, canSeeCosts, engineCall } from './access';
import { SnapshotService } from './snapshot.service';
import { AnalyticsService } from './analytics.service';
import { computePortfolio } from './domain/portfolio';

export const ADVISOR_TOOLS = ['service-performance', 'resource-capacity', 'portfolio-forecast', 'scenario-results', 'optimization-results', 'financial-alerts', 'benchmark-statistics'] as const;
export type AdvisorTool = (typeof ADVISOR_TOOLS)[number];
const TOOL_PERMISSION: Record<AdvisorTool, string> = {
  'service-performance': 'engine.economics.read', 'resource-capacity': 'engine.resources.read', 'portfolio-forecast': 'engine.economics.read', 'scenario-results': 'engine.scenarios.read',
  'optimization-results': 'engine.optimization.read', 'financial-alerts': 'engine.intelligence.read', 'benchmark-statistics': 'engine.services.read',
};

const RECOMMENDATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'recommendations', 'assumptionsToValidate'],
  properties: {
    summary: { type: 'string' },
    assumptionsToValidate: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title', 'problem', 'evidence', 'proposedAction', 'estimatedBenefit', 'assumptions', 'confidence', 'risks', 'responsibleRole', 'priority'],
      properties: {
        title: { type: 'string' }, problem: { type: 'string' }, proposedAction: { type: 'string' }, estimatedBenefit: { type: 'string' }, assumptions: { type: 'string' },
        confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }, risks: { type: 'string' }, responsibleRole: { type: 'string' }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'metric', 'value'],
          properties: { ref: { type: 'string', description: 'id of an entity from the provided data' }, metric: { type: 'string' }, value: { type: 'string', description: 'value copied verbatim from the data' } } } },
      } } },
  },
} as const;
const ANSWER_SCHEMA = { type: 'object', additionalProperties: false, required: ['answer', 'refs'], properties: { answer: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } } } as const;

interface AiRecommendation {
  title: string; problem: string; evidence: { ref: string; metric: string; value: string }[]; proposedAction: string; estimatedBenefit: string; assumptions: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'; risks: string; responsibleRole: string; priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

const SYSTEM = (language: string) => `You are the management advisor of OCTA PROJECTS GmbH (German engineering / EPCM consultancy).
Rules:
- Use ONLY the JSON data provided. Never invent revenue, costs, rates, cash balances, capacity, probabilities or solver results.
- Every recommendation needs evidence items whose "ref" is an "id" present in the data and whose "value" is copied verbatim from the data.
- Forecast, weighted and simulated values are not actual results — say so where relevant. If settings are illustrative, lower your confidence.
- You only advise. You cannot approve hires, sign contracts, change prices or execute payments; humans decide.
- Point out assumptions that management should validate.
Answer in ${language === 'de' ? 'German' : 'English'}.`;

@Injectable()
export class AdvisorService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiGatewayService, private readonly snapshots: SnapshotService, private readonly analytics: AnalyticsService) {}

  status() { return { enabled: this.ai.enabled, model: this.ai.enabled ? this.ai.model : null, tools: ADVISOR_TOOLS }; }

  /** Read-only analytical tools (also used to ground the model). Resources are pseudonymised. */
  async tool(companyId: string, user: AuthUser, name: string, mode: PortfolioMode = 'EXPECTED') {
    if (!ADVISOR_TOOLS.includes(name as AdvisorTool)) throw new BadRequestException(`Unknown tool ${name}`);
    if (!can(user, TOOL_PERMISSION[name as AdvisorTool])) return { tool: name, denied: true, reason: `Requires ${TOOL_PERMISSION[name as AdvisorTool]}` };
    const portfolio = async () => { const { snapshot } = await this.snapshots.build(companyId); return engineCall(() => computePortfolio(snapshot, mode)); };
    switch (name as AdvisorTool) {
      case 'service-performance': {
        const r = await portfolio();
        return { tool: name, calculatedAt: r.calculatedAt, mode: r.mode, currency: r.currency, illustrativeSettings: r.illustrativeConfig,
          services: r.byService.map((s) => ({ id: s.key, name: s.name, revenue: s.revenue, contribution: s.contribution, marginPct: s.marginPct, hours: s.hours, assignments: s.count })),
          attractiveness: (await this.analytics.attractiveness(companyId)).scores.map((s) => ({ id: s.serviceId, total: s.total, confidence: s.confidence, sampleCount: s.sampleCount, suggestedAction: s.suggestedAction })) };
      }
      case 'resource-capacity': {
        const r = await portfolio();
        return { tool: name, calculatedAt: r.calculatedAt, mode: r.mode, utilization: r.totals.utilization, shortageHours: r.totals.shortageHours,
          resources: r.capacity.resources.map((x) => ({ id: x.id, kind: x.kind, internal: x.internal, available: x.totals.available, planned: x.totals.planned, utilization: x.totals.utilization })),
          skills: r.capacity.skills.map((s) => ({ id: s.skillId ?? 'any', name: s.name, shortageHours: s.totalShortage })),
          bottlenecks: r.capacity.bottlenecks.slice(0, 40).map((b) => ({ id: b.id ?? 'any', kind: b.kind, month: b.periodKey, excessHours: b.excessHours })) };
      }
      case 'portfolio-forecast': {
        const r = await portfolio();
        return { tool: name, calculatedAt: r.calculatedAt, mode: r.mode, currency: r.currency, illustrativeSettings: r.illustrativeConfig, totals: r.totals,
          cash: { id: 'cash', opening: r.cash.opening, minBalance: r.cash.minBalance, minBalanceDate: r.cash.minBalanceDate, peakDeficit: r.cash.peakDeficit, financingRequirement: r.cash.financingRequirement },
          assignments: r.assignments.map((a) => ({ id: a.id, title: a.title, service: a.serviceName, client: a.clientName, commitment: a.commitment, probability: a.probability, revenue: a.revenue,
            contribution: a.contribution, marginPct: a.marginPct, baselineMarginPct: a.baselineMarginPct, hoursVariance: a.hoursVariance, shortageHours: a.shortageHours, peakFinancingNeed: a.cash.peakFinancingNeed })),
          months: r.pnl.map((p) => ({ id: p.key, revenue: p.revenue, contribution: p.contribution, operatingResult: p.operatingResult })) };
      }
      case 'scenario-results': {
        const runs = await this.prisma.engineScenarioRun.findMany({ where: { scenario: { companyId, deletedAt: null }, status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, take: 10,
          select: { id: true, kind: true, createdAt: true, scenario: { select: { id: true, name: true } }, result: true } });
        return { tool: name, runs: runs.map((r) => { const res = r.result as Record<string, unknown> | null; return { id: r.id, scenarioId: r.scenario.id, scenario: r.scenario.name, kind: r.kind, createdAt: r.createdAt,
          metrics: res?.metrics ?? null, baselineMetrics: res?.baselineMetrics ?? null, monteCarlo: r.kind === 'MONTE_CARLO' ? { ...res, assumptions: undefined } : undefined }; }) };
      }
      case 'optimization-results': {
        const runs = await this.prisma.engineOptimizationRun.findMany({ where: { companyId, status: { in: ['OPTIMAL', 'FEASIBLE', 'INFEASIBLE'] } }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, status: true, gapPct: true, result: true, createdAt: true } });
        return { tool: name, runs: runs.map((r) => { const res = r.result as { candidates?: { key: string; title: string; selected: boolean; variant: string | null; contribution: string; reasons: string[] }[]; objectives?: unknown; diagnostics?: string[] } | null;
          return { id: r.id, status: r.status, gapPct: r.gapPct?.toString() ?? null, createdAt: r.createdAt, objectives: res?.objectives, diagnostics: res?.diagnostics,
            candidates: res?.candidates?.map((c) => ({ id: c.key, title: c.title, selected: c.selected, variant: c.variant, contribution: c.contribution, reasons: c.reasons })) }; }) };
      }
      case 'financial-alerts': {
        const alerts = await this.prisma.engineAlert.findMany({ where: { companyId, status: { not: 'RESOLVED' } }, orderBy: { detectedAt: 'desc' }, take: 50,
          select: { id: true, ruleCode: true, severity: true, entityType: true, entityId: true, title: true, metric: true, detectedAt: true } });
        return { tool: name, alerts };
      }
      case 'benchmark-statistics': {
        const b = await this.analytics.benchmarks(companyId);
        return { tool: name, minSamples: b.minSamples, services: b.benchmarks.map((x) => ({ id: x.serviceId, code: x.code, sampleCount: x.sampleCount, confidence: x.confidence, effortRatioMedian: x.effortRatio.median, effortRatioP90: x.effortRatio.p90, marginDeltaMedian: x.marginDeltaPts.median })) };
      }
    }
  }

  private async context(companyId: string, user: AuthUser, mode: PortfolioMode) {
    const data: Record<string, unknown> = {};
    for (const name of ADVISOR_TOOLS) data[name] = await this.tool(companyId, user, name, mode);
    const text = JSON.stringify(data);
    const ids = new Set<string>();
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if ((k === 'id' || k === 'scenarioId') && typeof x === 'string') ids.add(x); walk(x); } };
    walk(data);
    return { data, text, ids };
  }

  /**
   * Grounded structured recommendations. Evidence whose reference or value cannot be found in the
   * engine data is discarded; recommendations without verified evidence are not stored.
   * Stored as PROPOSED — nothing is executed.
   */
  async analyze(companyId: string, user: AuthUser, options: { language?: string; mode?: PortfolioMode; question?: string }) {
    if (!canSeeCosts(user)) throw new BadRequestException('The advisor analyses financial data and requires engine.economics.read');
    const mode = options.mode ?? 'EXPECTED';
    const { text, ids } = await this.context(companyId, user, mode);
    const response = await this.ai.complete<{ summary: string; recommendations: AiRecommendation[]; assumptionsToValidate: string[] }>({
      feature: 'engine-advisor', system: SYSTEM(options.language ?? 'en'), maxTokens: 8000, jsonSchema: RECOMMENDATION_SCHEMA as unknown as Record<string, unknown>, userId: user.id, companyId,
      user: `${options.question ? `Management question: ${options.question}\n\n` : ''}Engine data (${mode}):\n${text}\n\nProduce at most 6 prioritised recommendations.`,
    });
    let discardedEvidence = 0;
    const grounded = response.recommendations.map((r) => {
      const evidence = r.evidence.filter((e) => ids.has(e.ref) && e.value.length > 0 && text.includes(e.value));
      discardedEvidence += r.evidence.length - evidence.length;
      return { ...r, evidence };
    }).filter((r) => r.evidence.length > 0);
    if (grounded.length) await this.prisma.engineRecommendation.createMany({ data: grounded.map((r) => ({ companyId, source: 'AI', title: r.title.slice(0, 300), problem: r.problem, evidence: r.evidence as unknown as Prisma.InputJsonValue,
      proposedAction: r.proposedAction, estimatedBenefit: r.estimatedBenefit ? `${r.estimatedBenefit} (AI interpretation — verify)` : null, assumptions: r.assumptions, confidence: r.confidence, risks: r.risks,
      responsibleRole: r.responsibleRole, priority: r.priority, refs: r.evidence.map((e) => ({ id: e.ref })) as unknown as Prisma.InputJsonValue, aiModel: this.ai.model, createdById: user.id })) });
    return { summary: response.summary, assumptionsToValidate: response.assumptionsToValidate, stored: grounded.length, rejectedUngrounded: response.recommendations.length - grounded.length, discardedEvidence, model: this.ai.model, labelling: 'AI_INTERPRETATION' };
  }

  async ask(companyId: string, user: AuthUser, question: string, options: { language?: string; mode?: PortfolioMode }) {
    if (!question.trim()) throw new BadRequestException('Question is required');
    const { text, ids } = await this.context(companyId, user, options.mode ?? 'EXPECTED');
    const response = await this.ai.complete<{ answer: string; refs: string[] }>({ feature: 'engine-advisor-ask', system: SYSTEM(options.language ?? 'en'), maxTokens: 4000,
      jsonSchema: ANSWER_SCHEMA as unknown as Record<string, unknown>, userId: user.id, companyId, user: `Question: ${question}\n\nEngine data:\n${text}` });
    return { answer: response.answer, refs: response.refs.filter((r) => ids.has(r)), unverifiedRefs: response.refs.filter((r) => !ids.has(r)), model: this.ai.model, labelling: 'AI_INTERPRETATION' };
  }
}
