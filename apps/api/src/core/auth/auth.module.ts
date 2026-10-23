import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminSecurityController } from './admin-security.controller';
import { OidcController } from './oidc.controller';
import { RbacService } from '../rbac/rbac.service';
import { AccountTokensService } from '../security/account-tokens.service';
import { AUTH_CONFIG, type AuthConfig, loadAuthConfig } from '../security/auth-config';
import { AuthService } from '../security/auth.service';
import { AuthorizationService } from '../security/authorization.service';
import { KeyRing } from '../security/crypto';
import { EmailNotificationService } from '../security/email-notification.service';
import { CsrfGuard, RecentAuthGuard, SessionAuthGuard } from '../security/guards';
import { SecurityMaintenanceService } from '../security/maintenance.service';
import { MfaChallengeService } from '../security/mfa-challenge.service';
import { MfaRecoveryService } from '../security/mfa-recovery.service';
import { MfaService } from '../security/mfa.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { RecoveryService } from '../security/recovery.service';
import { SecurityAuditService } from '../security/security-audit.service';
import { SecurityPolicyService } from '../security/security-policy.service';
import { SessionService } from '../security/session.service';
import { TotpService } from '../security/totp.service';
import { KEY_RING } from '../security/tokens';

@Global()
@Module({
  controllers: [AuthController, AdminSecurityController, OidcController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() },
    { provide: KEY_RING, inject: [AUTH_CONFIG], useFactory: (config: AuthConfig) => new KeyRing(config.keys, config.production) },
    RbacService,
    AuthService,
    AccountTokensService,
    AuthorizationService,
    EmailNotificationService,
    MfaChallengeService,
    MfaRecoveryService,
    MfaService,
    PasswordService,
    RateLimitService,
    RecoveryService,
    SecurityAuditService,
    SecurityPolicyService,
    SessionService,
    TotpService,
    SecurityMaintenanceService,
    SessionAuthGuard,
    CsrfGuard,
    RecentAuthGuard,
  ],
  exports: [AUTH_CONFIG, KEY_RING, RbacService, AuthService, AuthorizationService, SessionService, SecurityAuditService, SecurityPolicyService, EmailNotificationService, PasswordService, SessionAuthGuard, CsrfGuard, RecentAuthGuard],
})
export class AuthModule {}
