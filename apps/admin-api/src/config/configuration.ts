export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  httpPort: number;
  logLevel: string;
  adminWebOrigins: string[];
  redis: {
    host: string;
    port: number;
    password: string;
  };
  kafka: {
    brokers: string[];
    consumerGroup: string;
  };
  coreApi: {
    baseUrl: string;
    timeoutMs: number;
  };
  adminPostgresDsn: string;
}

function parseHostPort(addr: string): { host: string; port: number } {
  const [host, port] = addr.split(':');
  return { host, port: Number(port) };
}

/** @nestjs/config factory — reads already-Joi-validated process.env. */
export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  httpPort: Number(process.env.HTTP_PORT ?? 3001),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  adminWebOrigins: (process.env.ADMIN_WEB_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  redis: {
    ...parseHostPort(process.env.REDIS_ADDR ?? '127.0.0.1:6379'),
    password: process.env.REDIS_PASSWORD ?? '',
  },
  kafka: {
    brokers: (process.env.KAFKA_BOOTSTRAP_SERVERS ?? '').split(','),
    consumerGroup: process.env.ADMIN_API_CONSUMER_GROUP ?? 'admin-api',
  },
  coreApi: {
    baseUrl: process.env.CORE_API_BASE_URL ?? 'http://127.0.0.1:8000',
    timeoutMs: Number(process.env.CORE_API_TIMEOUT_MS ?? 3000),
  },
  adminPostgresDsn: process.env.ADMIN_API_POSTGRES_DSN ?? '',
});
