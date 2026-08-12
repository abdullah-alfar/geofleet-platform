import { Global, Module } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { PG_POOL } from '../integrations/postgres/postgres.module';
import { Database } from './schema';

export const KYSELY_DB = Symbol('KYSELY_DB');

/**
 * Wraps the same shared `pg.Pool` PostgresModule already provides (one
 * role, one pool — see that module's own comment) with Kysely's
 * type-safe query builder for the admin_read schema. Raw `pool.query()`
 * (TokenVerificationService, the Postgres health indicator) and Kysely
 * queries share the identical connections/credentials; Kysely doesn't
 * get its own pool.
 */
@Global()
@Module({
  providers: [
    {
      provide: KYSELY_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Kysely<Database> =>
        new Kysely<Database>({
          dialect: new PostgresDialect({ pool }),
        }),
    },
  ],
  exports: [KYSELY_DB],
})
export class DatabaseModule {}
