import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { MfaChallengeService } from './mfa-challenge.service';
import { MfaService } from './mfa.service';
import { RateLimitService } from './rate-limit.service';
import { SecurityAuditService } from './security-audit.service';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';

/** Retention: expired auth state is deleted; security events kept SECURITY_EVENT_RETENTION_DAYS. */
@Injectable()
export class SecurityMaintenanceService {
  private readonly logger = new Logger('SecurityMaintenance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly challenges: MfaChallengeService,
    private readonly mfa: MfaService,
    private readonly limits: RateLimitService,
    private readonly audit: SecurityAuditService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<Record<string, number>> {
    const result = {
      rateLimits: await this.limits.purgeExpired(),
      challenges: await this.challenges.purgeExpired(),
      enrollments: await this.mfa.purgeExpiredEnrollments(),
      sessions: await this.sessions.purgeExpired(30),
      tokens: (await this.prisma.oneTimeToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })).count,
      events: await this.audit.purgeOlderThan(this.config.securityEventRetentionDays),
      recoveryRequests: (await this.prisma.mfaRecoveryRequest.updateMany({ where: { status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } })).count,
    };
    this.logger.log(`purged ${JSON.stringify(result)}`);
    return result;
  }
}
