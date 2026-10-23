import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const production = process.env.NODE_ENV === 'production';

  // Behind the nginx/ingress proxy, take the client IP from X-Forwarded-For so
  // rate limits and audit logs see real clients rather than the proxy. Only
  // private-network hops are trusted by default, so direct clients can't spoof it.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');

  app.use(helmet());
  app.enableCors({
    // in production only the configured origins; never reflect arbitrary ones
    origin: process.env.APP_URL?.split(',') ?? !production,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
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

  const config = new DocumentBuilder()
    .setTitle('OCTA BMS API')
    .setDescription(
      'Enterprise Business Management System for engineering & EPCM consulting companies',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .addGlobalParameters({
      name: 'X-Company-Id',
      in: 'header',
      required: false,
      schema: { type: 'string' },
    })
    .build();
  // The API reference maps every endpoint; publish it in production only on request.
  if (!production || process.env.API_DOCS_ENABLED === 'true') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
