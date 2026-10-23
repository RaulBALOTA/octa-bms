import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { RbacService } from '../rbac/rbac.service';
import { AuthService } from './auth.service';
import { jwtSecret } from './jwt-secret';
import { readCookie } from './auth-cookies';
import { OidcController } from './oidc.controller';

describe('jwtSecret', () => {
  it('falls back to the dev secret outside production', () => {
    expect(jwtSecret({ NODE_ENV: 'development' })).toBe('dev-only-secret');
  });

  it.each([undefined, 'dev-only-secret', 'change-me-in-production', 'too-short'])(
    'refuses %s in production',
    (secret) => {
      expect(() => jwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret })).toThrow(/JWT_SECRET/);
    },
  );

  it('accepts a long random secret in production', () => {
    const secret = 'x'.repeat(48);
    expect(jwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret })).toBe(secret);
  });
});

describe('RbacService.getPermissions', () => {
  it('applies only global role assignments when there is no company context', async () => {
    const findMany = vi.fn(async (_args: any) => []);
    const rbac = new RbacService({ userRole: { findMany } } as any);
    await rbac.getPermissions('user-1', null);
    expect(findMany.mock.calls[0]![0].where).toEqual({ userId: 'user-1', companyId: null });
  });

  it('applies global and active-company assignments with a company context', async () => {
    const findMany = vi.fn(async (_args: any) => []);
    const rbac = new RbacService({ userRole: { findMany } } as any);
    await rbac.getPermissions('user-1', 'company-a');
    expect(findMany.mock.calls[0]![0].where).toEqual({
      userId: 'user-1',
      OR: [{ companyId: null }, { companyId: 'company-a' }],
    });
  });
});

describe('AuthService.refresh', () => {
  function setup(stored: { userId: string; revokedAt: Date | null } | null, rotatedCount: number) {
    const jwt = new JwtService({ secret: 'test-secret' });
    const prisma = {
      refreshToken: {
        updateMany: vi.fn(async (_args: any) => ({ count: rotatedCount })),
        findUnique: vi.fn(async () => stored),
        create: vi.fn(async () => ({})),
      },
      user: {
        findFirst: vi.fn(async () => ({ id: 'user-1', email: 'a@example.com' })),
      },
    };
    const auth = new AuthService(prisma as any, jwt, {} as any);
    const token = jwt.sign({ sub: 'user-1', type: 'refresh', jti: 'j' }, { expiresIn: 60 });
    return { auth, prisma, token };
  }

  it('rotates a live token into a new pair', async () => {
    const { auth, prisma, token } = setup(null, 1);
    const pair = await auth.refresh(token);
    expect(pair.accessToken).toBeTruthy();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany.mock.calls[0]![0].where).toMatchObject({ revokedAt: null });
  });

  it('revokes every session when a long-rotated token is replayed', async () => {
    const { auth, prisma, token } = setup({ userId: 'user-1', revokedAt: new Date(Date.now() - 3_600_000) }, 0);
    await expect(auth.refresh(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('only rejects a token rotated moments ago (concurrent tabs)', async () => {
    const { auth, prisma, token } = setup({ userId: 'user-1', revokedAt: new Date() }, 0);
    await expect(auth.refresh(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('session cookies', () => {
  it('reads one cookie out of a cookie header', () => {
    const req = { headers: { cookie: 'a=1; octa_refresh=tok%3Den; b=2' } } as any;
    expect(readCookie(req, 'octa_refresh')).toBe('tok=en');
    expect(readCookie(req, 'missing')).toBeUndefined();
    expect(readCookie({ headers: {} } as any, 'octa_refresh')).toBeUndefined();
  });
});

describe('OidcController state', () => {
  const env = { ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's' };
  function fakeRes() {
    return { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() };
  }

  it('binds the state to the browser with a cookie instead of server memory', () => {
    Object.assign(process.env, env);
    const controller = new OidcController({} as any, {} as any);
    const res = fakeRes();
    controller.login(res as any);
    const state = new URL(res.redirect.mock.calls[0]![0]).searchParams.get('state');
    expect(res.cookie).toHaveBeenCalledWith('octa_oidc_state', state, expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
  });

  it.each([undefined, 'other-state'])('rejects a callback whose state cookie is %s', async (cookieState) => {
    Object.assign(process.env, env);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const controller = new OidcController({} as any, {} as any);
    const res = fakeRes();
    const req = { headers: { cookie: cookieState ? `octa_oidc_state=${cookieState}` : '' } };
    await controller.callback('code', 'expected-state', undefined, req as any, res as any);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('sso=state'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
