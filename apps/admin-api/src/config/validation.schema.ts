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

  // admin-api's own login/session store and direct read/write access to
  // every business table its commands touch — no runtime dependency on
  // core-api at all anymore (see
  // docs/decisions/0011-admin-api-independent-service.md).
  ADMIN_API_POSTGRES_DSN: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
});
