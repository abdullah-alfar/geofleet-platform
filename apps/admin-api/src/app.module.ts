import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import configuration, { AppConfig } from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { PostgresModule } from './integrations/postgres/postgres.module';
import { RedisModule } from './integrations/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { RidesModule } from './modules/rides/rides.module';
import { TripsModule } from './modules/trips/trips.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AdminsModule } from './modules/admins/admins.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('logLevel', { infer: true }),
          // Reuses the id CorrelationIdMiddleware already assigned
          // (req.correlationId) instead of generating a second, different
          // id — every log line, the error envelope, and the response
          // header must all agree on one value per request.
          genReqId: (req: IncomingMessage & { correlationId?: string }) =>
            req.correlationId ?? randomUUID(),
          customProps: (req: IncomingMessage & { correlationId?: string }) => ({
            correlation_id: req.correlationId,
          }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-internal-token"]',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
          // /health is polled frequently by orchestrators — logging every
          // hit adds noise without adding signal.
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url === '/health',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
      }),
    }),
    CommonModule,
    PostgresModule,
    RedisModule,
    HealthModule,
    MetricsModule,
    AuditModule,
    AuthModule,
    DashboardModule,
    DriversModule,
    RidesModule,
    TripsModule,
    PaymentsModule,
    CustomersModule,
    RealtimeModule,
    AdminsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
