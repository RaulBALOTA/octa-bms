import {
  Controller,
  Get,
  Logger,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { Public } from './decorators';

/**
 * Azure Entra ID single sign-on (OIDC authorization-code flow).
 * Activates when ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET are
 * configured. Users are provisioned on first login (matched by Entra object
 * id, falling back to email) and receive the same JWT pair as local login.
 */
@ApiTags('auth')
@Controller('auth/oidc')
export class OidcController {
  private readonly logger = new Logger(OidcController.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  // short-lived anti-CSRF state store (single instance; Redis when scaled out)
  private readonly pendingStates = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private get config() {
    const tenantId = process.env.ENTRA_TENANT_ID;
    const clientId = process.env.ENTRA_CLIENT_ID;
    const clientSecret = process.env.ENTRA_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) return null;
    return {
      tenantId,
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/auth/oidc/callback`,
      appUrl: process.env.APP_URL ?? 'http://localhost:5180',
    };
  }

  @Public()
  @Get('status')
  status() {
    return { enabled: this.config !== null };
  }

  @Public()
  @Get('login')
  login(@Res() res: Response) {
    const config = this.config;
    if (!config) {
      throw new UnauthorizedException({
        code: 'SSO_NOT_CONFIGURED',
        message: 'Entra SSO is not configured',
      });
    }
    const state = randomBytes(24).toString('base64url');
    this.pendingStates.set(state, Date.now());
    // prune states older than 10 minutes
    for (const [key, created] of this.pendingStates) {
      if (Date.now() - created > 600_000) this.pendingStates.delete(key);
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state,
    });
    res.redirect(`${config.authority}/oauth2/v2.0/authorize?${params}`);
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const config = this.config;
    if (!config) throw new UnauthorizedException('SSO not configured');

    if (error || !code) {
      this.logger.warn(`OIDC callback error: ${error}`);
      return res.redirect(`${config.appUrl}/login?sso=failed`);
    }
    if (!state || !this.pendingStates.delete(state)) {
      return res.redirect(`${config.appUrl}/login?sso=state`);
    }

    // exchange the code for tokens
    const tokenResponse = await fetch(
      `${config.authority}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUri,
        }),
      },
    );
    if (!tokenResponse.ok) {
      this.logger.warn(`OIDC token exchange failed: ${tokenResponse.status}`);
      return res.redirect(`${config.appUrl}/login?sso=exchange`);
    }
    const tokens = (await tokenResponse.json()) as { id_token: string };

    // verify the id_token signature against the tenant's JWKS
    this.jwks ??= createRemoteJWKSet(
      new URL(`${config.authority}/discovery/v2.0/keys`),
    );
    let claims: {
      oid?: string;
      email?: string;
      preferred_username?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
    };
    try {
      const verified = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: `${config.authority}/v2.0`,
        audience: config.clientId,
      });
      claims = verified.payload as typeof claims;
    } catch (verifyError) {
      this.logger.warn(`OIDC id_token verification failed: ${String(verifyError)}`);
      return res.redirect(`${config.appUrl}/login?sso=verify`);
    }

    const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase();
    if (!email || !claims.oid) {
      return res.redirect(`${config.appUrl}/login?sso=claims`);
    }

    // provision or link the user
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ entraObjectId: claims.oid }, { email }], deletedAt: null },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          entraObjectId: claims.oid,
          firstName: claims.given_name ?? claims.name?.split(' ')[0] ?? 'New',
          lastName:
            claims.family_name ??
            claims.name?.split(' ').slice(1).join(' ') ??
            'User',
          displayName: claims.name,
        },
      });
      // membership in the first company + base EMPLOYEE role, so a fresh SSO
      // user can log in and sees the self-service scope only
      const company = await this.prisma.company.findFirst({
        where: { deletedAt: null },
      });
      const employeeRole = await this.prisma.role.findUnique({
        where: { code: 'EMPLOYEE' },
      });
      if (company) {
        await this.prisma.companyMembership.create({
          data: { userId: user.id, companyId: company.id, isDefault: true },
        });
        if (employeeRole) {
          await this.prisma.userRole.create({
            data: { userId: user.id, roleId: employeeRole.id, companyId: company.id },
          });
        }
      }
      this.logger.log(`provisioned SSO user ${email}`);
    } else if (!user.entraObjectId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { entraObjectId: claims.oid },
      });
    }
    if (!user.isActive) {
      return res.redirect(`${config.appUrl}/login?sso=inactive`);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const pair = await this.auth.issueTokensFor(user.id, user.email);
    // hand tokens to the SPA via URL fragment (never sent to any server)
    res.redirect(
      `${config.appUrl}/oidc#accessToken=${encodeURIComponent(pair.accessToken)}&refreshToken=${encodeURIComponent(pair.refreshToken)}`,
    );
  }
}
