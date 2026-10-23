import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { PrismaModule } from './core/prisma/prisma.module';
import { AuthModule } from './core/auth/auth.module';
import { JwtAuthGuard } from './core/auth/jwt-auth.guard';
import { CompanyContextGuard } from './core/auth/company-context.guard';
import { PermissionsGuard } from './core/rbac/permissions.guard';
import { AuditModule } from './core/audit/audit.module';
import { AuditInterceptor } from './core/audit/audit.interceptor';

import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { CorporateModule } from './modules/corporate/corporate.module';
import { CrmModule } from './modules/crm/crm.module';
import { SalesModule } from './modules/sales/sales.module';
import { HrModule } from './modules/hr/hr.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { FinanceModule } from './modules/finance/finance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchModule } from './modules/search/search.module';
import { AssetsModule } from './modules/assets/assets.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { LegalModule } from './modules/legal/legal.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { BiModule } from './modules/bi/bi.module';
import { AiModule } from './modules/ai/ai.module';
import { RecordsModule } from './modules/records/records.module';
import { CalendarModule } from './modules/business-calendar/calendar.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AuditModule,
    HealthModule,
    IdentityModule,
    MasterDataModule,
    CorporateModule,
    CrmModule,
    SalesModule,
    HrModule,
    ContractsModule,
    FinanceModule,
    NotificationsModule,
    SearchModule,
    AssetsModule,
    WorkflowModule,
    LegalModule,
    ProcurementModule,
    KnowledgeModule,
    DocumentsModule,
    CommunicationModule,
    BiModule,
    AiModule,
    RecordsModule,
    CalendarModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CompanyContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
