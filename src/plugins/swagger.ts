import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

/** OpenAPI document generated from the route schemas, served with Swagger UI at /docs. */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Facility Search API',
        version: '1.0.0',
        description:
          'Search Fitness Passport facilities by name and amenities. Get a token from POST /v1/auth/login, then use the Authorize button.',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
