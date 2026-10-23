import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const REUSE_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    if (!user || !user.isActive || !user.passwordHash) {
      // equalize timing with the password check so response latency does not
      // reveal which emails have an account
      await argon2.verify(await this.dummyHash(), password).catch(() => false);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCK_MINUTES * 60_000)
              : null,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string) {
    const payload = await this.jwt
      .verifyAsync<{ sub: string; type: string; jti: string }>(refreshToken)
      .catch(() => {
        throw new UnauthorizedException('Invalid refresh token');
      });
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = this.hash(refreshToken);
    // rotation: revoke the used token atomically, so two concurrent requests
    // with the same token cannot both obtain a new pair
    const now = new Date();
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (rotated.count !== 1) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      // A token presented again well after its rotation means it was copied:
      // revoke every session of that user so the stolen chain dies too. The
      // grace window tolerates two browser tabs refreshing at the same time.
      if (
        stored?.revokedAt &&
        now.getTime() - stored.revokedAt.getTime() > REUSE_GRACE_MS
      ) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException();

    return this.issueTokens(user.id, user.email);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken) },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        avatarUrl: true,
        locale: true,
        theme: true,
        isSystemAdmin: true,
        memberships: {
          where: { company: { deletedAt: null, isActive: true } },
          select: {
            isDefault: true,
            company: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    // Effective permissions for the default company, so the UI can show or
    // hide actions. The server re-checks on every request regardless.
    const defaultCompany =
      user.memberships.find((m) => m.isDefault)?.company ??
      user.memberships[0]?.company;
    const memberships = user.isSystemAdmin
      ? (await this.prisma.company.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
      })).map((company, index) => ({ isDefault: defaultCompany ? company.id === defaultCompany.id : index === 0, company }))
      : user.memberships;
    const permissions = user.isSystemAdmin
      ? ['*']
      : [...(await this.rbac.getPermissions(user.id, defaultCompany?.id ?? null))];

    return { ...user, memberships, permissions };
  }

  /** Lifetime of refresh tokens (and of the browser session cookie). */
  refreshTtlSeconds(): number {
    return Number(process.env.JWT_REFRESH_TTL ?? 604_800);
  }

  /** Public token issuance for SSO flows (OIDC callback). */
  issueTokensFor(userId: string, email: string) {
    return this.issueTokens(userId, email);
  }

  private async issueTokens(userId: string, email: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'access' },
      { expiresIn: Number(process.env.JWT_ACCESS_TTL ?? 900) },
    );
    const refreshTtl = this.refreshTtlSeconds();
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'refresh', jti: randomUUID() },
      { expiresIn: refreshTtl },
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  private dummyHashPromise: Promise<string> | null = null;

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2.hash(randomUUID());
    return this.dummyHashPromise;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
