import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CompanyId, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import { PageQueryDto } from '../../common/pagination';
import {
  AbsenceDto, ActionDto, ActionUpdateDto, ActualsDto, AdjustmentDto, AdvisorDto, AlertTransitionDto, AssignmentDto, AssignmentStatusDto, CompareDto, DecisionDto, DecisionOutcomeDto,
  DecisionTransitionDto, DemandDto, ForecastVersionDto, LifecycleDto, MilestoneDto, OptimizationDto, PackageDto, PmoProgressDto, PortfolioQuery, RateDto, RecalibrationDecisionDto,
  RecommendationStatusDto, ResourceDto, ResourceSkillsDto, RunScenarioDto, ScenarioDto, ScenarioStatusDto, ServiceDto, SettingsDto, SkillDto, SkillParentDto, SourcingDto,
} from './dto';
import { EngineSettingsService } from './settings.service';
import { CatalogService } from './catalog.service';
import { ResourcesService } from './resources.service';
import { AssignmentsService } from './assignments.service';
import { AnalyticsService, REPORTS } from './analytics.service';
import { ScenariosService } from './scenarios.service';
import { IntelligenceService } from './intelligence.service';
import { AdvisorService } from './advisor.service';
import { ENGINE_VERSION } from './domain/config';

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine/settings')
export class EngineSettingsController {
  constructor(private readonly settings: EngineSettingsService) {}
  @Get() @RequirePermission('engine.settings.read') get(@CompanyId() companyId: string) { return this.settings.get(companyId).then((s) => ({ ...s, engineVersion: ENGINE_VERSION })); }
  @Put() @RequirePermission('engine.settings.update') update(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SettingsDto) { return this.settings.update(companyId, user.id, dto); }
  @Get('revisions') @RequirePermission('engine.settings.read') revisions(@CompanyId() companyId: string) { return this.settings.revisions(companyId); }
}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine')
export class EngineCatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('services') @RequirePermission('engine.services.read')
  services(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Query('category') category?: string, @Query('lifecycle') lifecycle?: string, @Query('q') q?: string) { return this.catalog.listServices(c, u, { category, lifecycle, q }); }
  @Get('services/:id') @RequirePermission('engine.services.read') service(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.catalog.getService(c, id, u); }
  @Get('services/:id/versions/:version') @RequirePermission('engine.services.read')
  serviceVersion(@CompanyId() c: string, @Param('id') id: string, @Param('version', ParseIntPipe) v: number) { return this.catalog.serviceVersion(c, id, v); }
  @Post('services') @RequirePermission('engine.services.create') createService(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: ServiceDto) { return this.catalog.createService(c, u, dto); }
  @Put('services/:id') @RequirePermission('engine.services.update') updateService(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ServiceDto) { return this.catalog.updateService(c, id, u, dto); }
  @Post('services/:id/lifecycle') @RequirePermission('engine.services.update') lifecycle(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: LifecycleDto) { return this.catalog.transition(c, id, u, dto); }
  @Delete('services/:id') @HttpCode(204) @RequirePermission('engine.services.delete') archiveService(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.catalog.archiveService(c, id, u); }
  @Get('packages') @RequirePermission('engine.services.read') packages(@CompanyId() c: string) { return this.catalog.listPackages(c); }
  @Post('packages') @RequirePermission('engine.services.create') createPackage(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: PackageDto) { return this.catalog.savePackage(c, u, dto); }
  @Put('packages/:id') @RequirePermission('engine.services.update') updatePackage(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PackageDto) { return this.catalog.savePackage(c, u, dto, id); }
  @Delete('packages/:id') @HttpCode(204) @RequirePermission('engine.services.delete') archivePackage(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.catalog.archivePackage(c, id, u); }
  @Get('skills') @RequirePermission('engine.services.read') skills() { return this.catalog.listSkills(); }
  @Post('skills') @RequirePermission('engine.services.create') createSkill(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: SkillDto) { return this.catalog.createSkill(u, c, dto); }
  @Put('skills/:id/parent') @RequirePermission('engine.services.update') skillParent(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SkillParentDto) { return this.catalog.setSkillParent(u, c, id, dto.parentId ?? null); }
  @Get('templates') @RequirePermission('engine.services.read') templates() { return this.catalog.templates(); }
  @Post('templates/apply') @RequirePermission('engine.services.create') applyTemplates(@CompanyId() c: string, @CurrentUser() u: AuthUser) { return this.catalog.applyTemplates(c, u); }
}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine/resources')
export class EngineResourcesController {
  constructor(private readonly resources: ResourcesService) {}
  @Get() @RequirePermission('engine.resources.read') list(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Query('kind') kind?: string, @Query('status') status?: string) { return this.resources.list(c, u, { kind, status }); }
  @Get(':id') @RequirePermission('engine.resources.read') get(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.resources.get(c, id, u); }
  @Post() @RequirePermission('engine.resources.create') create(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: ResourceDto) { return this.resources.create(c, u, dto); }
  @Post('import-employees') @RequirePermission('engine.resources.create') importEmployees(@CompanyId() c: string, @CurrentUser() u: AuthUser) { return this.resources.importEmployees(c, u); }
  @Put(':id') @RequirePermission('engine.resources.update') update(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ResourceDto) { return this.resources.update(c, id, u, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermission('engine.resources.delete') archive(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.resources.archive(c, id, u); }
  @Post(':id/rates') @RequirePermission('engine.resources.update', 'engine.economics.update') addRate(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RateDto) { return this.resources.addRate(c, id, u, dto); }
  @Put(':id/skills') @RequirePermission('engine.resources.update') setSkills(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ResourceSkillsDto) { return this.resources.setSkills(c, id, u, dto.skills); }
  @Post(':id/absences') @RequirePermission('engine.resources.update') addAbsence(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AbsenceDto) { return this.resources.addAbsence(c, id, u, dto); }
  @Delete(':id/absences/:absenceId') @HttpCode(204) @RequirePermission('engine.resources.update') removeAbsence(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('absenceId') a: string) { return this.resources.removeAbsence(c, id, a, u); }
}

class AssignmentListQuery extends PageQueryDto {}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine/assignments')
export class EngineAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}
  @Get() @RequirePermission('engine.portfolio.read')
  list(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Query() query: AssignmentListQuery, @Query('status') status?: string, @Query('serviceId') serviceId?: string,
    @Query('clientId') clientId?: string, @Query('contractId') contractId?: string, @Query('opportunityId') opportunityId?: string) {
    return this.assignments.list(c, u, Object.assign(query, { status, serviceId, clientId, contractId, opportunityId }));
  }
  @Get(':id') @RequirePermission('engine.portfolio.read') get(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.assignments.get(c, id, u); }
  @Get(':id/economics') @RequirePermission('engine.portfolio.read', 'engine.economics.read') economics(@CompanyId() c: string, @Param('id') id: string) { return this.assignments.economics(c, id); }
  @Post() @RequirePermission('engine.portfolio.create') create(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: AssignmentDto) { return this.assignments.create(c, u, dto); }
  @Post('from-package/:packageId') @RequirePermission('engine.portfolio.create') fromPackage(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('packageId') p: string, @Body() dto: AssignmentDto) { return this.assignments.createFromPackage(c, u, p, dto); }
  @Put(':id') @RequirePermission('engine.portfolio.update') update(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AssignmentDto) { return this.assignments.update(c, id, u, dto); }
  @Post(':id/status') @RequirePermission('engine.portfolio.update') status(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AssignmentStatusDto) { return this.assignments.transition(c, id, u, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermission('engine.portfolio.delete') archive(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.assignments.archive(c, id, u); }
  @Post(':id/demands') @RequirePermission('engine.portfolio.update') addDemand(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DemandDto) { return this.assignments.addDemand(c, id, u, dto); }
  @Put(':id/demands/:demandId') @RequirePermission('engine.portfolio.update') updateDemand(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('demandId') d: string, @Body() dto: DemandDto) { return this.assignments.updateDemand(c, id, d, u, dto); }
  @Delete(':id/demands/:demandId') @HttpCode(204) @RequirePermission('engine.portfolio.update') removeDemand(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('demandId') d: string) { return this.assignments.removeDemand(c, id, d, u); }
  @Post(':id/demands/regenerate') @RequirePermission('engine.portfolio.update') regenerate(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.assignments.regenerateDemand(c, id, u); }
  @Post(':id/milestones') @RequirePermission('engine.portfolio.update') addMilestone(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: MilestoneDto) { return this.assignments.addMilestone(c, id, u, dto); }
  @Delete(':id/milestones/:milestoneId') @HttpCode(204) @RequirePermission('engine.portfolio.update') removeMilestone(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('milestoneId') m: string) { return this.assignments.removeMilestone(c, id, m, u); }
  @Post(':id/adjustments') @RequirePermission('engine.portfolio.update') addAdjustment(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AdjustmentDto) { return this.assignments.addAdjustment(c, id, u, dto); }
  @Post(':id/actuals') @RequirePermission('engine.portfolio.update') actuals(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ActualsDto) { return this.assignments.recordActuals(c, id, u, dto); }
  @Post(':id/forecast-versions') @RequirePermission('engine.portfolio.update') forecast(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ForecastVersionDto) { return this.assignments.addForecastVersion(c, id, u, dto); }
}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine/integrations/pmo')
export class EnginePmoController {
  constructor(private readonly assignments: AssignmentsService) {}
  /** Idempotent PMO progress upsert keyed by externalProjectRef + service code (PUT semantics). */
  @Put('progress') @RequirePermission('engine.portfolio.update') progress(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: PmoProgressDto) { return this.assignments.pmoProgress(c, u, dto); }
}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine/analytics')
export class EngineAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get('overview') @RequirePermission('engine.economics.read') overview(@CompanyId() c: string, @Query() q: PortfolioQuery) { return this.analytics.overview(c, q); }
  @Get('portfolio') @RequirePermission('engine.economics.read') portfolio(@CompanyId() c: string, @Query() q: PortfolioQuery) { return this.analytics.portfolio(c, q); }
  @Get('capacity') @RequirePermission('engine.resources.read') capacity(@CompanyId() c: string, @Query() q: PortfolioQuery) { return this.analytics.capacity(c, q); }
  @Get('benchmarks') @RequirePermission('engine.services.read') benchmarks(@CompanyId() c: string) { return this.analytics.benchmarks(c); }
  @Get('attractiveness') @RequirePermission('engine.economics.read') attractiveness(@CompanyId() c: string) { return this.analytics.attractiveness(c); }
  @Post('attractiveness/record') @RequirePermission('engine.services.update', 'engine.economics.read') record(@CompanyId() c: string, @CurrentUser() u: AuthUser) { return this.analytics.recordScores(c, u); }
  @Get('attractiveness/:serviceId/history') @RequirePermission('engine.economics.read') history(@CompanyId() c: string, @Param('serviceId') s: string) { return this.analytics.scoreHistory(c, s); }
  @Post('sourcing') @RequirePermission('engine.economics.read') sourcing(@CompanyId() c: string, @Body() dto: SourcingDto) { return this.analytics.sourcing(c, dto); }
  @Get('reports') @RequirePermission('engine.economics.read') reports() { return REPORTS; }
  @Get('reports/:code') @RequirePermission('engine.economics.export')
  async report(@CompanyId() c: string, @Param('code') code: string, @Query() q: PortfolioQuery, @Res() res: Response) {
    const { filename, csv } = await this.analytics.report(c, code, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csv);
  }
}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine')
export class EngineScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}
  @Get('scenarios') @RequirePermission('engine.scenarios.read') list(@CompanyId() c: string, @Query('archived') archived?: string) { return this.scenarios.list(c, archived === 'true'); }
  @Get('scenarios/:id') @RequirePermission('engine.scenarios.read') get(@CompanyId() c: string, @Param('id') id: string) { return this.scenarios.get(c, id); }
  @Post('scenarios') @RequirePermission('engine.scenarios.create') create(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: ScenarioDto) { return this.scenarios.create(c, u, dto); }
  @Put('scenarios/:id') @RequirePermission('engine.scenarios.update') update(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ScenarioDto) { return this.scenarios.update(c, id, u, dto); }
  @Post('scenarios/:id/duplicate') @RequirePermission('engine.scenarios.create') duplicate(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.scenarios.duplicate(c, id, u); }
  @Post('scenarios/:id/status') @RequirePermission('engine.scenarios.update') status(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ScenarioStatusDto) { return this.scenarios.setStatus(c, id, u, dto.status); }
  @Delete('scenarios/:id') @HttpCode(204) @RequirePermission('engine.scenarios.delete') remove(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.scenarios.remove(c, id, u); }
  @Post('scenarios/:id/runs') @RequirePermission('engine.scenarios.read', 'engine.economics.read') run(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RunScenarioDto) { return this.scenarios.run(c, id, u, dto); }
  @Post('scenario-compare') @RequirePermission('engine.scenarios.read', 'engine.economics.read') compare(@CompanyId() c: string, @Body() dto: CompareDto) { return this.scenarios.compare(c, dto); }
  @Get('scenario-runs/:runId') @RequirePermission('engine.scenarios.read', 'engine.economics.read') getRun(@CompanyId() c: string, @Param('runId') r: string) { return this.scenarios.getRun(c, r); }
  @Post('scenario-runs/:runId/cancel') @RequirePermission('engine.scenarios.update') cancelRun(@CompanyId() c: string, @Param('runId') r: string) { return this.scenarios.cancelRun(c, r); }
  @Post('scenario-runs/:runId/verify') @RequirePermission('engine.scenarios.read', 'engine.economics.read') verifyRun(@CompanyId() c: string, @Param('runId') r: string) { return this.scenarios.verifyRun(c, r); }
  @Get('optimizations') @RequirePermission('engine.optimization.read') optimizations(@CompanyId() c: string) { return this.scenarios.listOptimizations(c); }
  @Get('optimizations/:id') @RequirePermission('engine.optimization.read', 'engine.economics.read') optimization(@CompanyId() c: string, @Param('id') id: string) { return this.scenarios.getOptimization(c, id); }
  @Post('optimizations') @RequirePermission('engine.optimization.create', 'engine.economics.read') optimize(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: OptimizationDto) { return this.scenarios.startOptimization(c, u, dto); }
  @Post('optimizations/:id/cancel') @RequirePermission('engine.optimization.create') cancelOptimization(@CompanyId() c: string, @Param('id') id: string) { return this.scenarios.cancelOptimization(c, id); }
}

@ApiTags('business-engine')
@ApiBearerAuth()
@Controller('engine/intelligence')
export class EngineIntelligenceController {
  constructor(private readonly intelligence: IntelligenceService, private readonly advisor: AdvisorService) {}
  @Get('alerts') @RequirePermission('engine.intelligence.read') alerts(@CompanyId() c: string, @Query('status') status?: string, @Query('severity') severity?: string) { return this.intelligence.listAlerts(c, { status, severity }); }
  @Post('alerts/scan') @RequirePermission('engine.intelligence.create', 'engine.economics.read') scan(@CompanyId() c: string, @CurrentUser() u: AuthUser) { return this.intelligence.scan(c, u.id); }
  @Post('alerts/:id/status') @RequirePermission('engine.intelligence.update') alertStatus(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AlertTransitionDto) { return this.intelligence.transitionAlert(c, id, u, dto); }
  @Get('actions') @RequirePermission('engine.intelligence.read') actions(@CompanyId() c: string, @Query('status') status?: string) { return this.intelligence.listActions(c, status); }
  @Post('actions') @RequirePermission('engine.intelligence.create') createAction(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: ActionDto) { return this.intelligence.createAction(c, u, dto); }
  @Put('actions/:id') @RequirePermission('engine.intelligence.update') updateAction(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ActionUpdateDto) { return this.intelligence.updateAction(c, id, u, dto); }
  @Get('recommendations') @RequirePermission('engine.intelligence.read') recommendations(@CompanyId() c: string, @Query('status') status?: string) { return this.intelligence.listRecommendations(c, status); }
  @Post('recommendations/generate') @RequirePermission('engine.intelligence.create', 'engine.economics.read') generate(@CompanyId() c: string, @CurrentUser() u: AuthUser) { return this.intelligence.generateRuleRecommendations(c, u); }
  @Post('recommendations/:id/status') @RequirePermission('engine.intelligence.update') recommendationStatus(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RecommendationStatusDto) { return this.intelligence.setRecommendationStatus(c, id, u, dto.status); }
  @Get('decisions') @RequirePermission('engine.intelligence.read') decisions(@CompanyId() c: string) { return this.intelligence.listDecisions(c); }
  @Get('decisions/quality') @RequirePermission('engine.intelligence.read') quality(@CompanyId() c: string) { return this.intelligence.decisionQuality(c); }
  @Post('decisions') @RequirePermission('engine.intelligence.create') createDecision(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: DecisionDto) { return this.intelligence.createDecision(c, u, dto); }
  @Post('decisions/:id/status') @RequirePermission('engine.intelligence.update') decisionStatus(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionTransitionDto) { return this.intelligence.transitionDecision(c, id, u, dto); }
  @Post('decisions/:id/outcome') @RequirePermission('engine.intelligence.update') outcome(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionOutcomeDto) { return this.intelligence.recordOutcome(c, id, u, dto.actualOutcome); }
  @Get('recalibrations') @RequirePermission('engine.services.read') recalibrations(@CompanyId() c: string) { return this.intelligence.listRecalibrations(c); }
  @Post('recalibrations/generate') @RequirePermission('engine.services.update') generateRecalibrations(@CompanyId() c: string, @CurrentUser() u: AuthUser) { return this.intelligence.generateRecalibrations(c, u); }
  @Post('recalibrations/:id/decision') @RequirePermission('engine.services.approve') decide(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RecalibrationDecisionDto) { return this.intelligence.decideRecalibration(c, id, u, dto); }
  @Get('advisor') @RequirePermission('engine.intelligence.read') advisorStatus() { return this.advisor.status(); }
  @Get('advisor/tools/:name') @RequirePermission('engine.intelligence.read') tool(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Param('name') name: string, @Query() q: PortfolioQuery) { return this.advisor.tool(c, u, name, q.mode); }
  @Post('advisor/analyze') @RequirePermission('engine.intelligence.create', 'engine.economics.read') analyze(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: AdvisorDto) {
    return this.advisor.analyze(c, u, { language: dto.language, mode: dto.mode as never, question: dto.question });
  }
  @Post('advisor/ask') @RequirePermission('engine.intelligence.read') ask(@CompanyId() c: string, @CurrentUser() u: AuthUser, @Body() dto: AdvisorDto) {
    return this.advisor.ask(c, u, dto.question ?? '', { language: dto.language, mode: dto.mode as never });
  }
}
