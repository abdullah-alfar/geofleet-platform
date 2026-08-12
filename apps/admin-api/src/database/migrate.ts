import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { Pool } from 'pg';

/**
 * Standalone Kysely migration CLI — deliberately outside Nest's DI
 * (no ConfigModule/Joi validation, no app bootstrap). Migrations run
 * once, from a shell, the same way `php artisan migrate` does for
 * core-api; wiring this through the full Nest app would start Kafka/HTTP
 * listeners for no reason.
 *
 * Usage: (after sourcing .env)
 *   npm run migrate up       # migrate to latest
 *   npm run migrate down     # roll back one migration
 *   npm run migrate status   # list applied/pending migrations
 */
async function main(): Promise<void> {
  const direction = process.argv[2];
  if (!['up', 'down', 'status'].includes(direction)) {
    console.error('Usage: npm run migrate -- <up|down|status>');
    process.exit(1);
  }

  const connectionString = process.env.ADMIN_API_POSTGRES_DSN;
  if (!connectionString) {
    console.error('ADMIN_API_POSTGRES_DSN must be set (source .env first).');
    process.exit(1);
  }

  // Must match PostgresModule's search_path (admin_api owns admin_read,
  // not public) — this script builds its own Pool outside Nest's DI, so
  // it doesn't inherit that config automatically.
  const pool = new Pool({
    connectionString,
    options: '-c search_path=admin_read,public',
  });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
      // CJS require, not dynamic import() — this project's TS output
      // targets CommonJS (no "type": "module" in package.json), and
      // ts-node's register hook (this script runs under
      // `ts-node -r tsconfig-paths/register`) only patches `require`,
      // not the ESM loader.
      import: (filePath: string): Promise<Record<string, unknown>> =>
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic path, only known at runtime; see comment above.
        Promise.resolve(require(filePath) as Record<string, unknown>),
    }),
    // Kysely's own bookkeeping tables (kysely_migration,
    // kysely_migration_lock) default to `public` — admin_api only has
    // narrow column grants there (Phase 2 auth tables), not CREATE. It
    // owns `admin_read` outright (Phase 3), so that's where its own
    // migration history lives too.
    migrationTableSchema: 'admin_read',
  });

  if (direction === 'status') {
    const migrations = await migrator.getMigrations();
    for (const m of migrations) {
      console.log(`${m.executedAt ? '[X]' : '[ ]'} ${m.name}`);
    }
    await db.destroy();
    return;
  }

  const { error, results } =
    direction === 'up'
      ? await migrator.migrateToLatest()
      : await migrator.migrateDown();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(
        `${direction === 'up' ? 'Applied' : 'Reverted'}: ${result.migrationName}`,
      );
    } else {
      console.error(`Failed: ${result.migrationName}`);
    }
  }

  await db.destroy();

  if (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
