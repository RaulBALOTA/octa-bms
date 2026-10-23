import { Logger as NestLogger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AUTH_CONFIG, type AuthConfig, loadAuthConfig } from './core/security/auth-config';
import { PasswordService } from './core/security/password.service';

/** Applies HTTP-level security settings; shared with the integration tests. */
export function configureHttp(app: NestExpressApplication, config: AuthConfig) {
  // only trust X-Forwarded-* from the configured hops (default: loopback only)
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(
    helmet({
      // API responses are JSON/files; the SPA's CSP is served by the web tier (nginx)
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.enableCors({
    // explicit allow-list only — never reflect arbitrary origins with credentials
    origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Company-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}

async function bootstrap() {
  // fail fast on unsafe production configuration before opening any port
  const config = loadAuthConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureHttp(app, app.get<AuthConfig>(AUTH_CONFIG));

  const log = new NestLogger('Security');
  if (config.keys.insecureDevKey) log.warn('AUTH_ENCRYPTION_KEY not set — using the INSECURE development key (refused in production)');
  log.log(`Argon2id self-test: ${await app.get(PasswordService).benchmark()} ms (m=${config.argon2.memoryCost} KiB, t=${config.argon2.timeCost}, p=${config.argon2.parallelism})`);

  if (!config.production || process.env.SWAGGER_ENABLED === 'true') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('OCTA BMS API')
        .setDescription('Enterprise Business Management System for engineering & EPCM consulting companies')
        .setVersion('1.0')
        .addCookieAuth(config.cookie.session)
        .addGlobalParameters({ name: 'X-Company-Id', in: 'header', required: false, schema: { type: 'string' } })
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

if (require.main === module) void bootstrap();
