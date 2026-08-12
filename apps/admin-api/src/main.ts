import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { correlationIdMiddleware } from './common/middleware/correlation-id.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  // Must run before pino-http (configured inside AppModule/LoggerModule) so
  // every log line and the error envelope see the same correlation id.
  app.use(correlationIdMiddleware);

  app.useLogger(app.get(Logger));

  app.use(helmet());
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: true, limit: '256kb' }));

  const config = app.get(ConfigService<AppConfig, true>);
  const origins = config.get('adminWebOrigins', { infer: true });
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Local-environment-only, same gate core-api's GET /docs uses
  // (App\Http\Middleware\EnsureLocalEnvironment).
  if (!config.get('isProduction', { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('GeoFleet Admin API')
      .setDescription(
        'Admin BFF for the GeoFleet platform — aggregates read models built ' +
          'from Kafka projections and forwards operational commands to ' +
          "core-api's internal API. See docs/admin-api/.",
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('httpPort', { infer: true });
  await app.listen(port);
}

void bootstrap();
