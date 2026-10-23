import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import highsLoader from 'highs';
import type { EngineSnapshot, OptimizationObjective, PortfolioMode, ScenarioOperation, SensitivityParameter } from '../../../../../packages/shared/src/business-engine';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../core/auth/decorators';
import { can, engineCall, engineCallAsync } from './access';
import { CompareDto, OptimizationDto, RunScenarioDto, ScenarioDto, validateOperations } from './dto';
import { SnapshotService } from './snapshot.service';
import { EngineJobRunner } from './job-runner';
import { applyOperations, compareMetrics, runScenario, sensitivity } from './domain/scenario';
import { monteCarloAsync } from './domain/montecarlo';
import { optimize, type HighsLoader } from './domain/optimizer';
import { ENGINE_VERSION } from './domain/config';

const RUN_RETENTION = 20;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
/** Key-order independent serialisation (PostgreSQL JSONB does not preserve object key order). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const OBJECTIVES: OptimizationObjective[] = ['CONTRIBUTION', 'OPERATING_PROFIT', 'CASH', 'PEAK_WORKING_CAPITAL', 'RISK_ADJUSTED_VALUE', 'STRATEGIC'];

@Injectable()
export class ScenariosService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly snapshots: SnapshotService, private readonly jobs: EngineJobRunner) {}

  list(companyId: string, includeArchived = false) {
    return this.prisma.engineScenario.findMany({ where: { companyId, deletedAt: null, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) }, orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, description: true, status: true, mode: true, version: true, operations: true, updatedAt: true, createdById: true,
        runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, kind: true, status: true, createdAt: true } } } });
  }
  async get(companyId: string, id: string) {
    const row = await this.prisma.engineScenario.findFirst({ where: { id, companyId, deletedAt: null }, include: {
      runs: { orderBy: { createdAt: 'desc' }, take: RUN_RETENTION, select: { id: true, kind: true, status: true, scenarioVersion: true, engineVersion: true, seed: true, runtimeMs: true, error: true, createdAt: true, finishedAt: true } } } });
    if (!row) throw new NotFoundException('Scenario not found in this company');
    return row;
  }
  async create(companyId: string, user: AuthUser, dto: ScenarioDto, copiedFromId?: string) {
    const operations = validateOperations(dto.operations);
    const row = await this.prisma.engineScenario.create({ data: { companyId, name: dto.name.trim(), description: dto.description ?? null, mode: dto.mode, operations: json(operations), createdById: user.id, copiedFromId: copiedFromId ?? null } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_scenario', entityId: row.id, action: 'CREATE' });
    return row;
  }
  async update(companyId: string, id: string, user: AuthUser, dto: ScenarioDto) {
    const current = await this.get(companyId, id);
    if (current.status === 'APPROVED' || current.status === 'ARCHIVED') throw new BadRequestException('Approved or archived scenarios are read-only; duplicate to change');
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== current.version) throw new ConflictException('The scenario changed in the meantime. Reload before saving.');
    const operations = validateOperations(dto.operations);
    const row = await this.prisma.engineScenario.update({ where: { id }, data: { name: dto.name.trim(), description: dto.description ?? null, mode: dto.mode, operations: json(operations), version: current.version + 1 } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_scenario', entityId: id, action: 'UPDATE', changes: { operations: { old: current.operations, new: operations } } });
    return row;
  }
  async duplicate(companyId: string, id: string, user: AuthUser) {
    const s = await this.get(companyId, id);
    return this.create(companyId, user, { name: `${s.name} (copy)`, description: s.description, mode: s.mode, operations: s.operations as unknown[] }, id);
  }
  async setStatus(companyId: string, id: string, user: AuthUser, status: string) {
    const s = await this.get(companyId, id);
    if (status === 'APPROVED' && !can(user, 'engine.scenarios.approve')) throw new ForbiddenException('Approving scenarios requires engine.scenarios.approve');
    const row = await this.prisma.engineScenario.update({ where: { id }, data: { status } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_scenario', entityId: id, action: 'STATUS', changes: { status: { old: s.status, new: status } } });
    return row;
  }
  async remove(companyId: string, id: string, user: AuthUser) {
    await this.get(companyId, id);
    await this.prisma.engineScenario.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_scenario', entityId: id, action: 'DELETE' });
  }

  private async prune(scenarioId: string) {
    const old = await this.prisma.engineScenarioRun.findMany({ where: { scenarioId, status: { not: 'RUNNING' } }, orderBy: { createdAt: 'desc' }, skip: RUN_RETENTION, select: { id: true } });
    if (old.length) await this.prisma.engineScenarioRun.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }

  /**
   * Deterministic runs complete within the request; Monte Carlo and sensitivity runs execute in the
   * background and are polled. Every run stores its input snapshot, operations and engine version.
   */
  async run(companyId: string, id: string, user: AuthUser, dto: RunScenarioDto) {
    const scenario = await this.get(companyId, id);
    const operations = scenario.operations as unknown as ScenarioOperation[];
    const { snapshot } = await this.snapshots.build(companyId);
    const mode = scenario.mode as PortfolioMode;
    const config = snapshot.config.monteCarlo;
    if (dto.kind === 'MONTE_CARLO' && (dto.iterations ?? config.defaultIterations) > config.maxIterations) throw new BadRequestException(`At most ${config.maxIterations} iterations are allowed (engine settings)`);
    if (dto.kind === 'SENSITIVITY' && !dto.parameter) throw new BadRequestException('Sensitivity runs need a parameter');
    const seed = dto.kind === 'MONTE_CARLO' ? dto.seed ?? Math.floor(Math.random() * 2_147_483_647) : null;
    const parameters = { iterations: dto.iterations ?? config.defaultIterations, parameter: dto.parameter, steps: dto.steps ?? [-20, -10, 0, 10, 20], includeContracted: dto.includeContracted ?? false, mode };
    const run = await this.prisma.engineScenarioRun.create({ data: { scenarioId: id, scenarioVersion: scenario.version, kind: dto.kind, engineVersion: ENGINE_VERSION, seed,
      parameters: json(parameters), inputSnapshot: json(snapshot), operations: json(operations), createdById: user.id } });
    const started = Date.now();
    const finish = (data: Prisma.EngineScenarioRunUpdateInput) => this.prisma.engineScenarioRun.update({ where: { id: run.id }, data: { ...data, runtimeMs: Date.now() - started, finishedAt: new Date() } });
    if (dto.kind === 'DETERMINISTIC') {
      try {
        const result = engineCall(() => this.deterministic(snapshot, operations, mode, run.createdAt.toISOString()));
        await finish({ status: 'SUCCEEDED', result: json(result) });
      } catch (error) {
        await finish({ status: 'FAILED', error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      await this.prune(id);
      return this.getRun(companyId, run.id);
    }
    this.jobs.start(run.id, async (shouldStop) => {
      const result = dto.kind === 'MONTE_CARLO'
        ? await engineCallAsync(() => monteCarloAsync(applyOperations(snapshot, operations).snapshot, parameters.iterations, seed as number, shouldStop))
        : engineCall(() => sensitivity(applyOperations(snapshot, operations).snapshot, mode, dto.parameter as SensitivityParameter, parameters.steps, parameters.includeContracted));
      await finish({ status: shouldStop() ? 'CANCELLED' : 'SUCCEEDED', result: json(result) });
      await this.prune(id);
    }, async (error) => { await finish({ status: 'FAILED', error: error instanceof Error ? error.message : String(error) }); });
    return this.getRun(companyId, run.id);
  }
  private deterministic(snapshot: EngineSnapshot, operations: ScenarioOperation[], mode: PortfolioMode, calculatedAt: string) {
    const baseline = runScenario(snapshot, [], mode, calculatedAt);
    const scenario = runScenario(snapshot, operations, mode, calculatedAt);
    return { mode, labelling: 'SIMULATED', metrics: scenario.metrics, baselineMetrics: baseline.metrics, comparison: compareMetrics(baseline.metrics, [scenario.metrics]), log: scenario.log, portfolio: scenario.result };
  }

  async getRun(companyId: string, runId: string, includeSnapshot = false) {
    const row = await this.prisma.engineScenarioRun.findFirst({ where: { id: runId, scenario: { companyId } }, select: { id: true, scenarioId: true, scenarioVersion: true, kind: true, status: true,
      engineVersion: true, seed: true, parameters: true, operations: true, result: true, error: true, runtimeMs: true, createdAt: true, finishedAt: true, inputSnapshot: includeSnapshot } });
    if (!row) throw new NotFoundException('Run not found in this company');
    return { ...row, running: this.jobs.isRunning(row.id) };
  }
  async cancelRun(companyId: string, runId: string) {
    await this.getRun(companyId, runId);
    return { cancelled: this.jobs.cancel(runId) };
  }
  /** Recomputes a stored deterministic run from its stored inputs and checks the results are identical. */
  async verifyRun(companyId: string, runId: string) {
    const run = await this.getRun(companyId, runId, true);
    if (run.kind !== 'DETERMINISTIC' || run.status !== 'SUCCEEDED') throw new BadRequestException('Only successful deterministic runs can be re-verified');
    if (run.engineVersion !== ENGINE_VERSION) return { identical: false, reason: `Run used engine ${run.engineVersion}; current engine is ${ENGINE_VERSION}` };
    const params = run.parameters as { mode: PortfolioMode };
    const stored = run.result as { portfolio: { calculatedAt: string } };
    const again = engineCall(() => this.deterministic(run.inputSnapshot as unknown as EngineSnapshot, run.operations as unknown as ScenarioOperation[], params.mode, stored.portfolio.calculatedAt));
    return { identical: canonical(json(again)) === canonical(run.result), engineVersion: ENGINE_VERSION };
  }

  /** Side-by-side comparison against a common, freshly built baseline. */
  async compare(companyId: string, dto: CompareDto) {
    const scenarios = await this.prisma.engineScenario.findMany({ where: { id: { in: dto.scenarioIds }, companyId, deletedAt: null } });
    if (scenarios.length !== dto.scenarioIds.length) throw new NotFoundException('Scenario not found in this company');
    const { snapshot } = await this.snapshots.build(companyId);
    const mode = (dto.mode ?? 'EXPECTED') as PortfolioMode;
    const calculatedAt = new Date().toISOString();
    return engineCall(() => {
      const baseline = runScenario(snapshot, [], mode, calculatedAt);
      const ordered = dto.scenarioIds.map((sid) => scenarios.find((s) => s.id === sid) as (typeof scenarios)[number]);
      const runs = ordered.map((s) => runScenario(snapshot, s.operations as unknown as ScenarioOperation[], mode, calculatedAt));
      return { mode, asOf: snapshot.asOf, calculatedAt, labelling: 'SIMULATED', scenarios: ordered.map((s, i) => ({ id: s.id, name: s.name, log: runs[i].log })),
        rows: compareMetrics(baseline.metrics, runs.map((r) => r.metrics)), cash: [baseline, ...runs].map((r) => r.result.cash.months.map((m) => ({ key: m.key, closing: m.closing }))) };
    });
  }

  /* ---------------------------------------------------------------- optimization */
  listOptimizations(companyId: string) {
    return this.prisma.engineOptimizationRun.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, name: true, status: true, objectiveValue: true, bound: true, gapPct: true, runtimeMs: true, engineVersion: true, createdAt: true, finishedAt: true, error: true } });
  }
  async getOptimization(companyId: string, id: string) {
    const row = await this.prisma.engineOptimizationRun.findFirst({ where: { id, companyId }, select: { id: true, name: true, status: true, configuration: true, result: true, objectiveValue: true, bound: true,
      gapPct: true, runtimeMs: true, engineVersion: true, error: true, createdAt: true, finishedAt: true } });
    if (!row) throw new NotFoundException('Optimization run not found in this company');
    return { ...row, running: this.jobs.isRunning(row.id) };
  }
  async cancelOptimization(companyId: string, id: string) { await this.getOptimization(companyId, id); return { cancelled: this.jobs.cancel(id) }; }

  async startOptimization(companyId: string, user: AuthUser, dto: OptimizationDto, loader: HighsLoader = highsLoader as unknown as HighsLoader) {
    const weights = dto.objectiveWeights;
    if (weights) for (const [k, v] of Object.entries(weights)) {
      if (!OBJECTIVES.includes(k as OptimizationObjective)) throw new BadRequestException(`Unknown objective ${k}`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) throw new BadRequestException(`Invalid weight for ${k}`);
    }
    if (weights && !Object.values(weights).some((v) => v > 0)) throw new BadRequestException('At least one objective needs a positive weight');
    const hireOptions = validateOperations(dto.hireOptions ?? []);
    if (hireOptions.some((op) => op.type !== 'HIRE')) throw new BadRequestException('hireOptions may only contain HIRE operations');
    const { snapshot } = await this.snapshots.build(companyId);
    const configuration = { ...dto, objectiveWeights: weights ?? snapshot.config.optimization.objectiveWeights, hireOptions };
    const run = await this.prisma.engineOptimizationRun.create({ data: { companyId, name: dto.name ?? null, configuration: json(configuration), inputSnapshot: json(snapshot), engineVersion: ENGINE_VERSION, createdById: user.id } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_optimization', entityId: run.id, action: 'RUN' });
    this.jobs.start(run.id, async (shouldStop) => {
      const result = await engineCallAsync(() => optimize({ snapshot, objectiveWeights: configuration.objectiveWeights, timeLimitSeconds: dto.timeLimitSeconds, allowExternalSourcing: dto.allowExternalSourcing,
        allowShifts: dto.allowShifts, cashConstraint: dto.cashConstraint, basis: dto.basis, hireOptions: hireOptions as Extract<ScenarioOperation, { type: 'HIRE' }>[],
        mandatoryOpportunityKeys: dto.mandatoryOpportunityKeys, excludedOpportunityKeys: dto.excludedOpportunityKeys }, loader, shouldStop));
      await this.prisma.engineOptimizationRun.update({ where: { id: run.id }, data: { status: result.status, result: json(result), runtimeMs: result.runtimeMs, finishedAt: new Date(),
        objectiveValue: result.objectiveValue === null ? null : new Prisma.Decimal(result.objectiveValue.toFixed(2)), bound: result.bound === null ? null : new Prisma.Decimal(result.bound.toFixed(2)),
        gapPct: result.gapPct === null ? null : new Prisma.Decimal(result.gapPct.toFixed(4)) } });
    }, async (error) => {
      await this.prisma.engineOptimizationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
    });
    return this.getOptimization(companyId, run.id);
  }
}
