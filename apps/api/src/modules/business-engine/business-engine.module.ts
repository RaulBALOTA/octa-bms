import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  EngineAnalyticsController, EngineAssignmentsController, EngineCatalogController, EngineIntelligenceController, EnginePmoController, EngineResourcesController,
  EngineScenariosController, EngineSettingsController,
} from './engine.controllers';
import { EngineSettingsService } from './settings.service';
import { SnapshotService } from './snapshot.service';
import { CatalogService } from './catalog.service';
import { ResourcesService } from './resources.service';
import { AssignmentsService } from './assignments.service';
import { AnalyticsService } from './analytics.service';
import { ScenariosService } from './scenarios.service';
import { IntelligenceService } from './intelligence.service';
import { AdvisorService } from './advisor.service';
import { EngineJobRunner } from './job-runner';

/**
 * OCTA Business Engine (docs/business-engine). Deterministic calculations live in ./domain;
 * services adapt existing systems of record (CRM, Sales, Contracts, HR, Finance) read-only.
 */
@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [EngineSettingsController, EngineCatalogController, EngineResourcesController, EngineAssignmentsController, EnginePmoController,
    EngineAnalyticsController, EngineScenariosController, EngineIntelligenceController],
  providers: [EngineSettingsService, SnapshotService, CatalogService, ResourcesService, AssignmentsService, AnalyticsService, ScenariosService,
    IntelligenceService, AdvisorService, EngineJobRunner],
})
export class BusinessEngineModule {}
