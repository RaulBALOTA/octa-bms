import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Response } from 'express';
import { AccountTokensService } from '../security/account-tokens.service';
import { AUTH_CONFIG, type AuthConfig } from '../security/auth-config';
import { AuthError } from '../security/auth-errors';
import { AuthService } from '../security/auth.service';
import { setSessionCookie } from '../security/cookies';
import { EmailNotificationService } from '../security/email-notification.service';
import { MfaService } from '../security/mfa.service';
import { PasskeyService } from '../security/passkey.service';
import { RATE_LIMITS, RateLimitService } from '../security/rate-limit.service';
import { RecoveryService } from '../security/recovery.service';
import { SecurityAuditService } from '../security/security-audit.service';
import { SecurityPolicyService } from '../security/security-policy.service';
import { SessionService } from '../security/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { AllowPreAuth, type AuthenticatedRequest, Public, RequireRecentAuth } from './decorators';

class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
}
class OtpDto {
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code!: string;
}
class RecoveryCodeDto {
  @IsString() @Length(10, 16) code!: string;
}
class EnrollConfirmDto extends OtpDto {
  @IsString() @MaxLength(64) enrollmentId!: string;
}
class StepUpDto {
  @IsOptional() @IsString() @Matches(/^\d{6}$/) code?: string;
  @IsOptional() @IsString() @MaxLength(256) password?: string;
}
class ForgotDto {
  @IsEmail() @MaxLength(254) email!: string;
}
class ResetDto {
  @IsString() @Length(20, 128) token!: string;
  @IsString() @MaxLength(256) password!: string;
}
class ChangePasswordDto {
  @IsString() @MaxLength(256) currentPassword!: string;
  @IsString() @MaxLength(256) newPassword!: string;
}
class AcceptInvitationDto {
  @IsString() @Length(20, 128) token!: string;
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @IsString() @MaxLength(256) password!: string;
}
class TokenQuery {
  @IsString() @Length(20, 128) token!: string;
}
class PasskeyResponseDto {
  // shape is verified cryptographically by @simplewebauthn/server; body size is capped by the JSON parser
  @IsObject() response!: Record<string, unknown>;
}
class PasskeyRegisterDto extends PasskeyResponseDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
}
class PasskeyRenameDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
}
class DisableMfaDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}

function session(req: AuthenticatedRequest) {
  if (!req.authSession || !req.user) throw new AuthError('UNAUTHENTICATED');
  return { session: req.authSession, user: req.user };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: AccountTokensService,
    private readonly mfa: MfaService,
    private readonly passkeys: PasskeyService,
    private readonly recovery: RecoveryService,
    private readonly sessions: SessionService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: SecurityAuditService,
    private readonly email: EmailNotificationService,
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  // ------------------------------------------------------------ sign-in flow

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto.email, dto.password, req, res);
  }

  /** State machine position for route guards; never reveals anything before the password step. */
  @Public()
  @Get('state')
  state(@Req() req: AuthenticatedRequest) {
    return this.auth.state(req);
  }

  @AllowPreAuth()
  @Post('mfa/verify')
  @HttpCode(200)
  verify(@Body() dto: OtpDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.preAuth) throw new AuthError('MFA_CHALLENGE_INVALID');
    return this.auth.verifyTotp(req.preAuth, dto.code, req, res);
  }

  @AllowPreAuth()
  @Post('mfa/recovery')
  @HttpCode(200)
  recoveryLogin(@Body() dto: RecoveryCodeDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.preAuth) throw new AuthError('MFA_CHALLENGE_INVALID');
    return this.auth.redeemRecoveryCode(req.preAuth, dto.code, req, res);
  }

  /** Second-factor methods for this sign-in (only after the password step). */
  @AllowPreAuth()
  @Get('mfa/methods')
  methods(@Req() req: AuthenticatedRequest) {
    if (!req.preAuth) throw new AuthError('MFA_CHALLENGE_INVALID');
    return this.auth.loginMethods(req.preAuth);
  }

  @AllowPreAuth()
  @Post('mfa/passkey/options')
  @HttpCode(200)
  passkeyLoginOptions(@Req() req: AuthenticatedRequest) {
    if (!req.preAuth) throw new AuthError('MFA_CHALLENGE_INVALID');
    return this.auth.passkeyLoginOptions(req.preAuth, req);
  }

  @AllowPreAuth()
  @Post('mfa/passkey/verify')
  @HttpCode(200)
  passkeyLogin(@Body() dto: PasskeyResponseDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.preAuth) throw new AuthError('MFA_CHALLENGE_INVALID');
    return this.auth.verifyPasskeyLogin(req.preAuth, dto.response as unknown as AuthenticationResponseJSON, req, res);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
  }

  // ------------------------------------------------------------ enrollment

  /**
   * Starts Microsoft Authenticator enrollment. Allowed with an ENROLL pre-auth
   * challenge (policy requires MFA) or a full session (opt-in / re-enroll; re-enroll
   * replacing an active factor requires step-up).
   */
  @AllowPreAuth()
  @Post('mfa/enroll/start')
  @HttpCode(200)
  async enrollStart(@Req() req: AuthenticatedRequest) {
    const userId = await this.enrollmentSubject(req);
    await this.limits.assertHit(RATE_LIMITS.enrollUserFailures, userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
    const started = await this.mfa.startEnrollment(user);
    await this.audit.record({ action: 'mfa.totp.enrollment_started', outcome: 'success', actorUserId: userId, targetUserId: userId, req });
    return started;
  }

  @AllowPreAuth()
  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  async enrollConfirm(@Body() dto: EnrollConfirmDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const userId = await this.enrollmentSubject(req);
    await this.limits.assertBelow(RATE_LIMITS.enrollUserFailures, userId);
    let result: { authenticatorId: string; recoveryCodes: string[] };
    try {
      result = await this.mfa.confirmEnrollment(userId, dto.enrollmentId, dto.code);
    } catch (error) {
      await this.limits.hit(RATE_LIMITS.enrollUserFailures, userId);
      await this.audit.record({ action: 'mfa.totp.enrolled', outcome: 'failure', actorUserId: userId, targetUserId: userId, req });
      throw error;
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.audit.record({ action: 'mfa.totp.enrolled', outcome: 'success', actorUserId: userId, targetUserId: userId, req, context: { authenticatorId: result.authenticatorId } });
    this.email.notify(user.email, { kind: 'mfa-enabled' }, userId);

    let csrfToken: string;
    if (req.authSession) {
      // other sessions signed in without this factor are revoked by policy on next use
      await this.sessions.revokeAllForUser(userId, 'MFA_RESET', req.authSession.id);
      const rotated = await this.sessions.rotate(req.authSession, { mfa: true, reauth: true, req });
      setSessionCookie(res, this.config, rotated.token, rotated.session.absoluteExpiresAt);
      csrfToken = rotated.session.csrfToken;
    } else {
      const challenge = req.preAuth!;
      const { count } = await this.prisma.mfaChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (count !== 1) throw new AuthError('MFA_CHALLENGE_INVALID');
      const created = await this.auth.startSession(user, { mfa: true, method: challenge.authMethod as 'password' | 'oidc', via: 'enrollment' }, req, res);
      csrfToken = created.csrfToken;
    }
    // shown exactly once; never retrievable again
    return { status: 'AUTHENTICATED', csrfToken, recoveryCodes: result.recoveryCodes };
  }

  private async enrollmentSubject(req: AuthenticatedRequest): Promise<string> {
    if (req.authSession && req.user) {
      const policy = await this.policy.get();
      const existing = await this.mfa.activeAuthenticator(req.user.id);
      if (policy.mfaMode === 'DISABLED' && !existing) throw new AuthError('FORBIDDEN', 'MFA enrollment is disabled by policy');
      // adding/replacing a factor next to an existing one needs a current factor; a first
      // factor needs the password — otherwise a hijacked session could bind the attacker's
      // authenticator to the account
      const factors = await this.policy.factors(req.user.id);
      const hasFactor = factors.totp || factors.passkeys > 0;
      const verifiedAt = hasFactor ? req.authSession.lastMfaAt : req.authSession.lastReauthAt;
      if (!verifiedAt || Date.now() - verifiedAt.getTime() > policy.stepUpMaxAgeMinutes * 60_000) {
        const step = await this.auth.stepUpMethod(req.user.id);
        throw new AuthError('STEP_UP_REQUIRED', undefined, { method: step.method, methods: step.methods, maxAgeMinutes: policy.stepUpMaxAgeMinutes });
      }
      return req.user.id;
    }
    if (req.preAuth?.purpose === 'ENROLL') {
      return req.preAuth.userId;
    }
    throw new AuthError('MFA_CHALLENGE_INVALID');
  }

  // ------------------------------------------------------------ signed-in user

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    const { user, session: s } = session(req);
    return this.auth.me(user.id, s);
  }

  @Get('sessions')
  async listSessions(@Req() req: AuthenticatedRequest) {
    const { user, session: s } = session(req);
    const rows = await this.sessions.list(user.id);
    return rows.map((row) => ({ ...row, current: row.id === s.id }));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    // scoped to the caller: another user's session id simply does not match
    const { count } = await this.prisma.authSession.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'USER_REVOKED' } });
    if (count !== 1) throw new AuthError('FORBIDDEN', 'Session not found');
    await this.audit.record({ action: 'session.revoked', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req, context: { sessionId: id } });
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Req() req: AuthenticatedRequest) {
    const { user, session: s } = session(req);
    const count = await this.sessions.revokeAllForUser(user.id, 'LOGOUT_ALL', s.id);
    await this.audit.record({ action: 'session.revoked_all', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req, context: { count } });
    return { revoked: count };
  }

  @Get('step-up')
  stepUpInfo(@Req() req: AuthenticatedRequest) {
    return this.auth.stepUpMethod(session(req).user.id);
  }

  @Post('step-up/start')
  @HttpCode(200)
  stepUpStart(@Req() req: AuthenticatedRequest) {
    return this.auth.stepUpMethod(session(req).user.id);
  }

  @Post('step-up/verify')
  @HttpCode(200)
  stepUpVerify(@Body() dto: StepUpDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.stepUp(session(req).session, dto, req, res);
  }

  @Post('step-up/passkey/options')
  @HttpCode(200)
  stepUpPasskeyOptions(@Req() req: AuthenticatedRequest) {
    return this.auth.stepUpPasskeyOptions(session(req).session);
  }

  @Post('step-up/passkey/verify')
  @HttpCode(200)
  stepUpPasskey(@Body() dto: PasskeyResponseDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.stepUpPasskey(session(req).session, dto.response as unknown as AuthenticationResponseJSON, req, res);
  }

  // ------------------------------------------------------------ passkeys (administrators)

  private async assertPasskeyEligible(userId: string) {
    const policy = await this.policy.get();
    if (!policy.passkeysEnabled) throw new AuthError('FORBIDDEN', 'Passkeys are disabled by policy');
    if (!(await this.passkeys.isEligible(userId))) throw new AuthError('FORBIDDEN', 'Passkeys are available to administrators');
  }

  @Get('passkeys')
  async listPasskeys(@Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    return { eligible: (await this.passkeys.isEligible(user.id)) && (await this.policy.get()).passkeysEnabled, passkeys: await this.passkeys.list(user.id) };
  }

  /** Registration needs a recent verification: current factor, or password for a first factor. */
  @RequireRecentAuth()
  @Post('passkeys/register/options')
  @HttpCode(200)
  async passkeyRegisterOptions(@Req() req: AuthenticatedRequest) {
    const { user, session: s } = session(req);
    await this.assertPasskeyEligible(user.id);
    await this.limits.assertHit(RATE_LIMITS.enrollUserFailures, user.id);
    const profile = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, email: true, displayName: true } });
    return this.passkeys.registrationOptions(profile, s.id);
  }

  @RequireRecentAuth()
  @Post('passkeys/register/verify')
  @HttpCode(200)
  async passkeyRegister(@Body() dto: PasskeyRegisterDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const { user, session: s } = session(req);
    await this.assertPasskeyEligible(user.id);
    let result: Awaited<ReturnType<PasskeyService['register']>>;
    try {
      result = await this.passkeys.register(user.id, s.id, dto.response as unknown as RegistrationResponseJSON, dto.name);
    } catch (error) {
      await this.limits.hit(RATE_LIMITS.enrollUserFailures, user.id);
      await this.audit.record({ action: 'mfa.passkey.registered', outcome: 'failure', actorUserId: user.id, targetUserId: user.id, req });
      throw error;
    }
    await this.audit.record({ action: 'mfa.passkey.registered', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req, context: { passkeyId: result.passkey.id, synced: result.passkey.backedUp } });
    this.email.notify(user.email, { kind: 'passkey-added', name: result.passkey.name }, user.id);
    // a new factor: other sessions without it are re-checked by policy; rotate this one
    const rotated = await this.sessions.rotate(s, { mfa: true, reauth: true, req });
    setSessionCookie(res, this.config, rotated.token, rotated.session.absoluteExpiresAt);
    return { passkey: result.passkey, recoveryCodes: result.recoveryCodes, csrfToken: rotated.session.csrfToken };
  }

  @Patch('passkeys/:id')
  async renamePasskey(@Param('id') id: string, @Body() dto: PasskeyRenameDto, @Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    await this.passkeys.rename(user.id, id, dto.name);
    return { id, name: dto.name.trim() };
  }

  /** Removing a passkey: step-up; never the last factor when MFA is required, nor an admin's last passkey when passkeys are required. */
  @RequireRecentAuth()
  @Delete('passkeys/:id')
  @HttpCode(204)
  async removePasskey(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    // ownership first: another user's passkey id is simply "not found"
    if (!(await this.prisma.webAuthnCredential.count({ where: { id, userId: user.id, revokedAt: null } }))) throw new AuthError('FORBIDDEN', 'Passkey not found');
    const [factors, policy, record] = await Promise.all([
      this.policy.factors(user.id), this.policy.get(),
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { isSystemAdmin: true, mfaRequired: true, email: true } }),
    ]);
    const requirement = this.policy.requirementFor(policy, record, false);
    const lastFactor = factors.passkeys <= 1 && !factors.totp;
    if (lastFactor && (requirement.required || record.isSystemAdmin)) throw new AuthError('MFA_REQUIRED_BY_POLICY', 'This is your last second factor; register another one first');
    if (factors.passkeys <= 1 && policy.requirePasskeyForAdmins && record.isSystemAdmin) throw new AuthError('PASSKEY_REQUIRED', 'Administrators must keep at least one passkey');
    await this.passkeys.revoke(user.id, id);
    await this.audit.record({ action: 'mfa.passkey.removed', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req, context: { passkeyId: id } });
    this.email.notify(record.email, { kind: 'passkey-removed' }, user.id);
  }

  @Get('recovery-codes/status')
  async recoveryStatus(@Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    const factors = await this.policy.factors(user.id);
    const enrolled = factors.totp || factors.passkeys > 0;
    return { enrolled, remaining: enrolled ? await this.recovery.remaining(user.id) : 0 };
  }

  @RequireRecentAuth()
  @Post('recovery-codes/rotate')
  @HttpCode(200)
  async rotateRecoveryCodes(@Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    const factors = await this.policy.factors(user.id);
    if (!factors.totp && !factors.passkeys) throw new AuthError('MFA_NOT_ENROLLED', 'Register an authenticator or passkey first');
    const codes = await this.recovery.generate(user.id);
    await this.audit.record({ action: 'mfa.recovery_codes.rotated', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req });
    this.email.notify(user.email, { kind: 'recovery-codes-rotated' }, user.id);
    return { recoveryCodes: codes };
  }

  /** Turning MFA off: only when policy does not require it, with step-up and a current code. */
  @RequireRecentAuth()
  @Post('mfa/disable')
  @HttpCode(200)
  async disableMfa(@Body() dto: DisableMfaDto, @Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const policy = await this.policy.get();
    const required = record.mfaRequired || policy.mfaMode === 'ENFORCED' || policy.mfaMode === 'ENROLLMENT_REQUIRED' || record.isSystemAdmin;
    if (required) throw new AuthError('MFA_REQUIRED_BY_POLICY', 'Two-step verification is required for your account; use “replace authenticator” instead');
    if (!(await this.mfa.verify(user.id, dto.code))) throw new AuthError('MFA_CODE_INVALID');
    await this.mfa.removeAll(user.id);
    await this.audit.record({ action: 'mfa.totp.disabled', outcome: 'success', actorUserId: user.id, targetUserId: user.id, req });
    this.email.notify(record.email, { kind: 'mfa-disabled' }, user.id);
    return { enrolled: false };
  }

  @Get('security/activity')
  async activity(@Req() req: AuthenticatedRequest) {
    const { user } = session(req);
    return this.prisma.securityEvent.findMany({
      where: { targetUserId: user.id },
      select: { id: true, action: true, outcome: true, createdAt: true, ipPrefix: true, userAgent: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @RequireRecentAuth()
  @Post('password/change')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthenticatedRequest) {
    const { user, session: s } = session(req);
    await this.tokens.changePassword(user.id, s.id, dto.currentPassword, dto.newPassword, req);
  }

  // ------------------------------------------------------------ anonymous flows

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() dto: ForgotDto, @Req() req: AuthenticatedRequest) {
    await this.tokens.requestPasswordReset(dto.email, req);
    return { message: 'If an account exists for this address, we sent instructions.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetDto, @Req() req: AuthenticatedRequest) {
    await this.tokens.resetPassword(dto.token, dto.password, req);
  }

  /** POST so the token never appears in URLs, access logs or Referer headers. */
  @Public()
  @Post('invitations/preview')
  @HttpCode(200)
  previewInvitation(@Body() dto: TokenQuery, @Req() req: AuthenticatedRequest) {
    return this.tokens.previewInvitation(dto.token, req);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(201)
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: AuthenticatedRequest) {
    return this.tokens.acceptInvitation(dto.token, dto, req);
  }

  /** Public, minimal: lets the login page show SSO and password-policy hints. */
  @Public()
  @Get('config')
  publicConfig() {
    return { passwordMinLength: this.config.passwordMinLength, mfaIssuer: this.config.mfa.issuer };
  }
}
