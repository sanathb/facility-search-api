import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { FacilityRepository } from '../repositories/facility-repository.js';

const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  facilityCount: Type.Integer(),
  uptimeSeconds: Type.Integer(),
});

export const healthRoutes: FastifyPluginCallbackTypebox<{ repository: FacilityRepository }> = (
  app,
  { repository },
  done,
) => {
  app.get(
    '/health',
    {
      // Load balancers poll this constantly, so it is exempt from rate limiting.
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        summary: 'Liveness check',
        response: { 200: HealthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      facilityCount: await repository.count(),
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
  done();
};
