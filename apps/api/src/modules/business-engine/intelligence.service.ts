import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../core/auth/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { can, engineCall, toDate } from './access';
import { ActionDto, ActionUpdateDto, AlertTransitionDto, DecisionDto, DecisionTransitionDto, RecalibrationDecisionDto } from './dto';
import { SnapshotService } from './snapshot.service';
import { AnalyticsService } from './analytics.service';
import { computePortfolio } from './domain/portfolio';
import { evaluateAlerts, ruleRecommendations } from './domain/intelligence';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const SEVERITY_RANK: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
/** Decision lifecycle; approval and rejection require engine.intelligence.approve. */
const DECISION_FLOW: Record<string, string[]> = {
  DRAFT: ['UNDER_REVIEW', 'SUPERSEDED'], UNDER_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'], APPROVED: ['IMPLEMENTED', 'SUPERSEDED'],
  REJECTED: ['DRAFT'], IMPLEMENTED: ['SUPERSEDED'], SUPERSEDED: [],
};

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService,
    private readonly snapshots: SnapshotService, private readonly analytics: AnalyticsService) {}

  /* ---------------------------------------------------------------- alerts */
  /** Daily scan for every company using the engine. Failures are isolated per company. */
  @Cron('0 30 5 * * *')
  async scheduledScan() {
    const companies = await this.prisma.company.findMany({ where: { deletedAt: null, isActive: true, engineAssignments: { some: { deletedAt: null } } }, select: { id: true } }).catch(() => []);
    for (const c of companies) await this.scan(c.id, null).catch((error) => this.logger.error(`Engine alert scan failed for ${c.id}: ${String(error)}`));
  }

  /**
   * Evaluates alert rules, upserts by dedupe key (no duplicates while open), escalates severity,
   * auto-resolves cleared conditions, and notifies owners only on creation or escalation.
   */
  async scan(companyId: string, userId: string | null) {
    const { snapshot } = await this.snapshots.build(companyId);
    const expected = engineCall(() => computePortfolio(snapshot, 'EXPECTED'));
    const contracted = engineCall(() => computePortfolio(snapshot, 'CONTRACTED'));
    const now = new Date();
    const overdueRows = await this.prisma.invoice.findMany({ where: { companyId, deletedAt: null, direction: 'OUTGOING', status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: now } },
      select: { id: true, invoiceNumber: true, grossAmount: true, paidAmount: true, dueDate: true, partner: { select: { name: true } } } });
    const overdue = overdueRows.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, clientName: i.partner.name, open: i.grossAmount.minus(i.paidAmount).toFixed(2),
      overdueDays: Math.floor((now.getTime() - i.dueDate.getTime()) / 86_400_000) }));
    // Cash reserve is checked conservatively on contracted work only; all other rules on the expected portfolio.
    const candidates = [...evaluateAlerts(snapshot, expected, overdue).filter((a) => a.ruleCode !== 'CASH_BELOW_RESERVE'),
      ...evaluateAlerts(snapshot, contracted, []).filter((a) => a.ruleCode === 'CASH_BELOW_RESERVE')];
    const open = await this.prisma.engineAlert.findMany({ where: { companyId, status: { not: 'RESOLVED' } } });
    const byKey = new Map(open.map((a) => [a.dedupeKey, a]));
    let created = 0, escalated = 0, resolved = 0;
    for (const c of candidates) {
      const existing = byKey.get(c.dedupeKey);
      const recipients = [...new Set([c.ownerUserId, ...snapshot.config.alerts.recipientUserIds].filter((x): x is string => !!x))];
      if (!existing) {
        const row = await this.prisma.engineAlert.create({ data: { companyId, ruleCode: c.ruleCode, severity: c.severity, entityType: c.entityType, entityId: c.entityId, dedupeKey: c.dedupeKey,
          title: c.title, detail: c.detail, metric: json(c.metric), ownerUserId: c.ownerUserId } });
        created++;
        await this.notifications.notify({ userIds: recipients, type: 'SYSTEM', title: c.title, body: c.detail, entityType: 'engine_alert', entityId: row.id, link: '/engine/intelligence' });
      } else {
        const escalate = SEVERITY_RANK[c.severity] > SEVERITY_RANK[existing.severity];
        await this.prisma.engineAlert.update({ where: { id: existing.id }, data: { lastSeenAt: now, title: c.title, detail: c.detail, metric: json(c.metric), ...(escalate ? { severity: c.severity, status: 'OPEN' } : {}) } });
        if (escalate) { escalated++; await this.notifications.notify({ userIds: recipients, type: 'SYSTEM', title: `Escalated: ${c.title}`, body: c.detail, entityType: 'engine_alert', entityId: existing.id, link: '/engine/intelligence' }); }
        byKey.delete(c.dedupeKey);
      }
    }
    for (const stale of byKey.values()) {
      await this.prisma.engineAlert.update({ where: { id: stale.id }, data: { status: 'RESOLVED', resolvedAt: now, resolution: 'Condition no longer detected by the engine' } });
      resolved++;
    }
    await this.audit.log({ userId, companyId, entityType: 'engine_alert', entityId: 'scan', action: 'SCAN', changes: { created: { old: null, new: created }, escalated: { old: null, new: escalated }, resolved: { old: null, new: resolved } } });
    return { evaluated: candidates.length, created, escalated, resolved, calculatedAt: expected.calculatedAt };
  }

  listAlerts(companyId: string, query: { status?: string; severity?: string }) {
    return this.prisma.engineAlert.findMany({ where: { companyId, ...(query.status ? { status: query.status } : { status: { not: 'RESOLVED' } }), ...(query.severity ? { severity: query.severity } : {}) },
      orderBy: [{ detectedAt: 'desc' }], take: 200, include: { actions: { select: { id: true, title: true, status: true } } } });
  }
  async transitionAlert(companyId: string, id: string, user: AuthUser, dto: AlertTransitionDto) {
    const alert = await this.prisma.engineAlert.findFirst({ where: { id, companyId } });
    if (!alert) throw new NotFoundException('Alert not found in this company');
    if (alert.status === 'RESOLVED') throw new BadRequestException('Alert is already resolved');
    const data = dto.status === 'ACKNOWLEDGED' ? { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: user.id }
      : { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: user.id, resolution: dto.resolution ?? 'Resolved manually' };
    const row = await this.prisma.engineAlert.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_alert', entityId: id, action: dto.status, changes: { status: { old: alert.status, new: dto.status } } });
    return row;
  }

  /* ---------------------------------------------------------------- corrective actions */
  listActions(companyId: string, status?: string) {
    return this.prisma.engineAction.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 200,
      include: { alert: { select: { id: true, title: true, severity: true } } } });
  }
  async createAction(companyId: string, user: AuthUser, dto: ActionDto) {
    if (dto.alertId && !(await this.prisma.engineAlert.findFirst({ where: { id: dto.alertId, companyId }, select: { id: true } }))) throw new BadRequestException('Alert not found in this company');
    if (dto.ownerUserId && !(await this.prisma.companyMembership.findUnique({ where: { userId_companyId: { userId: dto.ownerUserId, companyId } } }))) throw new BadRequestException('Owner must be a member of this company');
    const row = await this.prisma.engineAction.create({ data: { companyId, kind: dto.kind, title: dto.title.trim(), description: dto.description ?? null, alertId: dto.alertId ?? null,
      entityType: dto.entityType ?? null, entityId: dto.entityId ?? null, ownerUserId: dto.ownerUserId ?? null, dueDate: dto.dueDate ? toDate(dto.dueDate) : null, createdById: user.id } });
    if (row.ownerUserId && row.ownerUserId !== user.id) await this.notifications.notify({ userIds: [row.ownerUserId], type: 'TASK_ASSIGNED', title: `Engine action: ${row.title}`, entityType: 'engine_action', entityId: row.id, link: '/engine/intelligence' });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_action', entityId: row.id, action: 'CREATE' });
    return row;
  }
  async updateAction(companyId: string, id: string, user: AuthUser, dto: ActionUpdateDto) {
    const current = await this.prisma.engineAction.findFirst({ where: { id, companyId } });
    if (!current) throw new NotFoundException('Action not found in this company');
    const row = await this.prisma.engineAction.update({ where: { id }, data: { status: dto.status, outcome: dto.outcome ?? current.outcome } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_action', entityId: id, action: 'UPDATE', changes: { status: { old: current.status, new: dto.status } } });
    return row;
  }

  /* ---------------------------------------------------------------- recommendations */
  listRecommendations(companyId: string, status?: string) {
    return this.prisma.engineRecommendation.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: [{ createdAt: 'desc' }], take: 200 });
  }
  /** Deterministic, AI-independent recommendations; identical open proposals are not duplicated. */
  async generateRuleRecommendations(companyId: string, user: AuthUser) {
    const { snapshot } = await this.snapshots.build(companyId);
    const result = engineCall(() => computePortfolio(snapshot, 'EXPECTED'));
    const { scores } = await this.analytics.attractiveness(companyId);
    const recs = ruleRecommendations(snapshot, result, scores);
    const open = new Set((await this.prisma.engineRecommendation.findMany({ where: { companyId, status: 'PROPOSED', source: 'RULE' }, select: { title: true } })).map((r) => r.title));
    const fresh = recs.filter((r) => !open.has(r.title));
    if (fresh.length) await this.prisma.engineRecommendation.createMany({ data: fresh.map((r) => ({ companyId, source: 'RULE', title: r.title, problem: r.problem, evidence: json({ ...r.evidence, calculatedAt: result.calculatedAt, mode: result.mode }),
      proposedAction: r.proposedAction, estimatedBenefit: r.estimatedBenefit, assumptions: r.assumptions, confidence: r.confidence, risks: r.risks, responsibleRole: r.responsibleRole,
      priority: r.priority, refs: json(r.refs), createdById: user.id })) });
    return { generated: fresh.length, skippedDuplicates: recs.length - fresh.length };
  }
  async setRecommendationStatus(companyId: string, id: string, user: AuthUser, status: string) {
    const row = await this.prisma.engineRecommendation.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Recommendation not found in this company');
    const updated = await this.prisma.engineRecommendation.update({ where: { id }, data: { status } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_recommendation', entityId: id, action: status, changes: { status: { old: row.status, new: status } } });
    return updated;
  }

  /* ---------------------------------------------------------------- decisions */
  listDecisions(companyId: string) {
    return this.prisma.engineDecision.findMany({ where: { companyId }, orderBy: { updatedAt: 'desc' }, take: 200,
      include: { recommendation: { select: { id: true, title: true, source: true } }, events: { orderBy: { createdAt: 'asc' } } } });
  }
  /** Decisions record management intent; they never change contracts, prices, payroll or finance records. */
  async createDecision(companyId: string, user: AuthUser, dto: DecisionDto) {
    let expectedImpact: Prisma.InputJsonValue | undefined;
    if (dto.recommendationId && !(await this.prisma.engineRecommendation.findFirst({ where: { id: dto.recommendationId, companyId }, select: { id: true } }))) throw new BadRequestException('Recommendation not found');
    if (dto.scenarioId) {
      const run = await this.prisma.engineScenarioRun.findFirst({ where: { scenarioId: dto.scenarioId, scenario: { companyId }, kind: 'DETERMINISTIC', status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, select: { id: true, result: true } });
      if (!run && !(await this.prisma.engineScenario.findFirst({ where: { id: dto.scenarioId, companyId }, select: { id: true } }))) throw new BadRequestException('Scenario not found');
      if (run) { const r = run.result as { metrics: unknown; baselineMetrics: unknown }; expectedImpact = json({ source: 'scenario', runId: run.id, metrics: r.metrics, baselineMetrics: r.baselineMetrics }); }
    }
    if (dto.optimizationRunId) {
      const opt = await this.prisma.engineOptimizationRun.findFirst({ where: { id: dto.optimizationRunId, companyId }, select: { id: true, status: true, result: true } });
      if (!opt) throw new BadRequestException('Optimization run not found');
      const r = opt.result as { verification?: unknown; objectives?: unknown } | null;
      expectedImpact = json({ source: 'optimization', runId: opt.id, status: opt.status, objectives: r?.objectives ?? null, verification: r?.verification ?? null });
    }
    const row = await this.prisma.engineDecision.create({ data: { companyId, title: dto.title.trim(), context: dto.context ?? null, recommendationId: dto.recommendationId ?? null, scenarioId: dto.scenarioId ?? null,
      optimizationRunId: dto.optimizationRunId ?? null, expectedImpact, createdById: user.id, events: { create: { fromStatus: null, toStatus: 'DRAFT', note: 'Created', createdById: user.id } } } });
    if (dto.recommendationId) await this.prisma.engineRecommendation.update({ where: { id: dto.recommendationId }, data: { status: 'ACCEPTED' } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_decision', entityId: row.id, action: 'CREATE' });
    return row;
  }
  async transitionDecision(companyId: string, id: string, user: AuthUser, dto: DecisionTransitionDto) {
    const d = await this.prisma.engineDecision.findFirst({ where: { id, companyId } });
    if (!d) throw new NotFoundException('Decision not found in this company');
    if (!DECISION_FLOW[d.status]?.includes(dto.status)) throw new BadRequestException(`Transition ${d.status} → ${dto.status} is not allowed`);
    if (['APPROVED', 'REJECTED'].includes(dto.status) && !can(user, 'engine.intelligence.approve')) throw new ForbiddenException('Approving or rejecting decisions requires engine.intelligence.approve');
    const [row] = await this.prisma.$transaction([
      this.prisma.engineDecision.update({ where: { id }, data: { status: dto.status } }),
      this.prisma.engineDecisionEvent.create({ data: { decisionId: id, fromStatus: d.status, toStatus: dto.status, note: dto.note ?? null, createdById: user.id } }),
    ]);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_decision', entityId: id, action: dto.status, changes: { status: { old: d.status, new: dto.status } } });
    return row;
  }
  async recordOutcome(companyId: string, id: string, user: AuthUser, actualOutcome: string) {
    const d = await this.prisma.engineDecision.findFirst({ where: { id, companyId } });
    if (!d) throw new NotFoundException('Decision not found in this company');
    if (!['IMPLEMENTED', 'REJECTED', 'SUPERSEDED'].includes(d.status)) throw new BadRequestException('Outcomes are recorded after implementation (or rejection)');
    const row = await this.prisma.engineDecision.update({ where: { id }, data: { actualOutcome, outcomeRecordedAt: new Date() } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_decision', entityId: id, action: 'OUTCOME' });
    return row;
  }
  /** Decision quality: implemented decisions with expected impact next to the recorded outcome. */
  async decisionQuality(companyId: string) {
    const rows = await this.prisma.engineDecision.findMany({ where: { companyId, status: { in: ['IMPLEMENTED', 'SUPERSEDED'] } }, orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, status: true, expectedImpact: true, actualOutcome: true, outcomeRecordedAt: true, recommendation: { select: { source: true } } } });
    return { decisions: rows, withOutcome: rows.filter((r) => r.actualOutcome).length, total: rows.length };
  }

  /* ---------------------------------------------------------------- recalibration */
  listRecalibrations(companyId: string) {
    return this.prisma.engineRecalibration.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100, include: { service: { select: { id: true, code: true, name: true } } } });
  }
  async generateRecalibrations(companyId: string, user: AuthUser) {
    const proposals = await this.analytics.recalibrationCandidates(companyId);
    const open = new Set((await this.prisma.engineRecalibration.findMany({ where: { companyId, status: 'PROPOSED' }, select: { serviceId: true } })).map((r) => r.serviceId));
    const fresh = proposals.filter((p) => !open.has(p.serviceId));
    if (fresh.length) await this.prisma.engineRecalibration.createMany({ data: fresh.map((p) => ({ companyId, serviceId: p.serviceId, metric: p.metric, currentValue: p.currentValue, proposedValue: p.proposedValue, sampleCount: p.sampleCount, statistics: json(p.statistics) })) });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_recalibration', entityId: 'generate', action: 'GENERATE', changes: { created: { old: null, new: fresh.length } } });
    return { generated: fresh.length, candidates: proposals.length };
  }
  /** Approval scales the service's typical effort profile and records a new template version; never automatic. */
  async decideRecalibration(companyId: string, id: string, user: AuthUser, dto: RecalibrationDecisionDto) {
    if (!can(user, 'engine.services.approve')) throw new ForbiddenException('Approving recalibrations requires engine.services.approve');
    const r = await this.prisma.engineRecalibration.findFirst({ where: { id, companyId, status: 'PROPOSED' } });
    if (!r) throw new NotFoundException('Open recalibration proposal not found');
    if (dto.status === 'APPROVED') {
      const factor = Number(r.currentValue) > 0 ? Number(r.proposedValue) / Number(r.currentValue) : 1;
      await this.prisma.$transaction(async (tx) => {
        const service = await tx.engineService.findUniqueOrThrow({ where: { id: r.serviceId }, include: { requirements: true } });
        for (const req of service.requirements) await tx.engineServiceRequirement.update({ where: { id: req.id }, data: { typicalHours: Math.round(Number(req.typicalHours) * factor * 100) / 100 } });
        const updated = await tx.engineService.update({ where: { id: service.id }, data: { version: service.version + 1, updatedById: user.id }, include: { requirements: true } });
        await tx.engineServiceVersion.create({ data: { serviceId: service.id, version: updated.version, snapshot: json(updated), note: `Recalibrated effort ×${factor.toFixed(4)} from ${r.sampleCount} completed assignments`, createdById: user.id } });
        await tx.engineRecalibration.update({ where: { id }, data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), note: dto.note ?? null } });
      });
    } else await this.prisma.engineRecalibration.update({ where: { id }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), note: dto.note ?? null } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_recalibration', entityId: id, action: dto.status });
    return this.prisma.engineRecalibration.findUnique({ where: { id } });
  }
}
