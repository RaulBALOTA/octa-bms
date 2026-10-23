import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { Secret, HOTP } from 'otpauth';

export const ORIGIN = 'http://localhost:5180';
export const PASSWORD = 'tangerine orbit lantern 42';

/**
 * Boots the real AppModule against an isolated schema created for this run.
 * Destructive cleanup (DROP SCHEMA) is restricted to that uniquely named schema.
 */
export async function bootTestApp(env: Record<string, string> = {}, opts: { reuseSchemaOf?: { schema: string; baseUrl: string } } = {}) {
  const base = opts.reuseSchemaOf?.baseUrl ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required for integration tests');
  const schema = opts.reuseSchemaOf?.schema ?? `auth_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MAIL_TRANSPORT: 'memory',
    APP_PUBLIC_ORIGIN: ORIGIN,
    ARGON2_MEMORY_KIB: '19456',
    ARGON2_TIME_COST: '2',
    ARGON2_PARALLELISM: '1',
    MFA_REQUIRED_MODE: 'optional',
    ...env,
  });
  const require = createRequire(import.meta.url);
  if (!opts.reuseSchemaOf) execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', join(__dirname, '../../prisma/schema.prisma')], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });

  const { AppModule } = await import('../../src/app.module');
  const { configureHttp } = await import('../../src/main');
  const { AUTH_CONFIG } = await import('../../src/core/security/auth-config');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureHttp(app, app.get(AUTH_CONFIG));
  await app.init();

  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const hash = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  async function close() {
    await app.close();
    if (!opts.reuseSchemaOf) await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
  return { app, db, schema, baseUrl: base, hash, close };
}

export type TestApp = Awaited<ReturnType<typeof bootTestApp>>;

/** Cookie-jar HTTP client that behaves like the SPA: Origin + CSRF header on mutations. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  csrf: string | undefined;
  constructor(app: INestApplication, readonly ip = '198.51.100.10') {
    this.agent = request.agent(app.getHttpServer());
  }
  get(path: string) {
    return this.agent.get(`/api/v1${path}`).set('X-Forwarded-For', this.ip);
  }
  /** Request with an explicit Cookie header (bypasses the jar) — for forged/planted cookies. */
  static withCookie(app: INestApplication, method: 'get' | 'post', path: string, cookie: string) {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`).set('Cookie', cookie).set('Origin', ORIGIN).set('Content-Type', 'application/json');
    return req;
  }
  send(method: 'post' | 'patch' | 'delete' | 'put', path: string, body?: object, opts: { origin?: string | null; csrf?: string | null } = {}) {
    let req = this.agent[method](`/api/v1${path}`).set('X-Forwarded-For', this.ip).set('Content-Type', 'application/json');
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin) req = req.set('Origin', origin);
    const csrf = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (csrf) req = req.set('X-CSRF-Token', csrf);
    return body ? req.send(body) : req.send();
  }
  post(path: string, body?: object, opts?: { origin?: string | null; csrf?: string | null }) {
    return this.send('post', path, body, opts);
  }
  async login(email: string, password = PASSWORD) {
    const res = await this.post('/auth/login', { email, password });
    if (res.body?.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }
  async refreshCsrf() {
    const res = await this.get('/auth/state');
    this.csrf = res.body.csrfToken;
    return res.body;
  }
}

export function totpFor(secretBase32: string, offsetSteps = 0) {
  const step = Math.floor(Date.now() / 30_000) + offsetSteps;
  return HOTP.generate({ secret: Secret.fromBase32(secretBase32), algorithm: 'SHA1', digits: 6, counter: step });
}

export function secretFromManualKey(manualKey: string) {
  return manualKey.replace(/\s/g, '');
}

export function cookieHeader(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}
