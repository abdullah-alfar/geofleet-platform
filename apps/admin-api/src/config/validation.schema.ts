import * as Joi from 'joi';

/**
 * Fails fast on boot if the environment is misconfigured, rather than
 * surfacing as a confusing runtime error the first time a dependency is
 * touched (e.g. an unreachable Kafka broker discovered only when the first
 * projection consumer starts, phases from now).
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  HTTP_PORT: Joi.number().port().default(3001),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),

  // Comma-separated list of origins allowed to call this API from a
  // browser (the admin web app). No wildcard default — an admin BFF with
  // no configured origin should fail closed, not open.
  ADMIN_WEB_ORIGINS: Joi.string().allow('').default(''),

  REDIS_ADDR: Joi.string().required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  KAFKA_BOOTSTRAP_SERVERS: Joi.string().required(),
  // Not consumed until Phase 4 (projection consumers) — declared now so
  // .env.example documents the full eventual shape in one place.
  ADMIN_API_CONSUMER_GROUP: Joi.string().default('admin-api'),

  CORE_API_BASE_URL: Joi.string().uri().required(),
  CORE_API_TIMEOUT_MS: Joi.number().integer().positive().default(3000),

  // Required as of Phase 2 (auth-only: verifies Sanctum tokens against the
  // admin_api role — see docs/decisions/0009-admin-identity.md). The
  // broader admin_read schema for Kafka projections is still Phase 3.
  ADMIN_API_POSTGRES_DSN: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
});
