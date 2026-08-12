import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppConfig } from '../../config/configuration';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Owns the Pool's lifecycle so it closes cleanly on shutdown — a plain
 * useFactory provider has nowhere to hook OnModuleDestroy into, so the
 * pool is wrapped in its own injectable instead of provided directly.
 */
@Injectable()
class AdminApiPgPool implements OnModuleDestroy {
  private readonly logger = new Logger(AdminApiPgPool.name);
  readonly pool: Pool;

  constructor(config: ConfigService<AppConfig, true>) {
    this.pool = new Pool({
      connectionString: config.get('adminPostgresDsn', { infer: true }),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
      // admin_api owns the admin_read schema as of Phase 3 (see
      // docs/decisions/0009-admin-identity.md and
      // docs/admin-api/read-models.md) — putting it first in search_path
      // means Kysely/raw queries against projection tables don't need an
      // `admin_read.` prefix, while unqualified references to the three
      // Phase 2 auth tables (personal_access_tokens/users/admins) still
      // resolve via the `public` fallback. One role, one pool, two
      // schemas — not two separate connections to the same database.
      options: '-c search_path=admin_read,public',
    });

    // node-postgres emits 'error' on the pool when an *idle* client's
    // connection drops in the background (e.g. Postgres restarts) — with
    // no listener, Node treats that as an uncaught exception and kills
    // the entire process, not just the one query. Caught live: stopping
    // Postgres to test PostgresHealthIndicator's failure path crashed the
    // whole admin-api process instead of just failing /ready. The next
    // query against a dead connection still rejects normally and is
    // reported by PostgresHealthIndicator/AllExceptionsFilter as usual —
    // this handler only stops the background event from being fatal.
    this.pool.on('error', (err: Error) => {
      this.logger.error('Postgres pool background error', err.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * A single shared pool, connected as the `admin_api` Postgres role
 * (docs/decisions/0009-admin-identity.md): authentication (Phase 2 —
 * personal_access_tokens/users/admins in `public`) and, as of Phase 3,
 * the `admin_read` schema this role owns for Kafka-projection read
 * models (see database/database.module.ts for the Kysely wrapper used
 * for the latter).
 */
@Global()
@Module({
  providers: [
    AdminApiPgPool,
    {
      provide: PG_POOL,
      inject: [AdminApiPgPool],
      useFactory: (holder: AdminApiPgPool): Pool => holder.pool,
    },
  ],
  exports: [PG_POOL],
})
export class PostgresModule {}
