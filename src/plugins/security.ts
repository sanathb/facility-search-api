import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

/** Security headers, CORS and rate limiting. Must be registered before any routes. */
export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  // Helmet's defaults include upgrade-insecure-requests: fine behind TLS. Over plain HTTP,
  // Swagger UI loads only from localhost.
  await app.register(helmet);

  // CORS stays off unless allowed origins are configured.
  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins });
  }

  // Counts are kept in memory, so limits apply per instance (see README for Redis).
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });
}
