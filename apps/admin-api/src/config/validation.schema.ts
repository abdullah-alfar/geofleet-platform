import * as Joi from 'joi';

/**
 * Fails fast on boot if the environment is misconfigured, rather than
 * surfacing as a confusing runtime error the first time a dependency is
 * touched.
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

  CORE_API_BASE_URL: Joi.string().uri().required(),
  CORE_API_TIMEOUT_MS: Joi.number().integer().positive().default(3000),

  // Sent as X-Internal-Service-Token on internal/v1/* calls — both
  // commands and reads go through this boundary now (see
  // docs/decisions/0010-internal-service-authentication.md and
  // docs/admin-api/query-apis.md).
  ADMIN_API_INTERNAL_TOKEN: Joi.string().required(),

  // Auth-only: verifies Sanctum tokens against the admin_api role (see
  // docs/decisions/0009-admin-identity.md). No admin_read schema anymore
  // — every other query goes through core-api's internal/v1 read
  // endpoints instead.
  ADMIN_API_POSTGRES_DSN: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
});
